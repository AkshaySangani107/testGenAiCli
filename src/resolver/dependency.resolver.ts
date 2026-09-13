import * as fs from 'fs'
import * as path from 'path'
import { Project, SourceFile } from 'ts-morph'

interface ResolvedDependency {
    filePath: string
    content: string
    type: 'repository' | 'dto' | 'entity' | 'exception' | 'service' | 'other'
}

// ── Detect file type from path and content ──
function detectFileType(
    filePath: string
): ResolvedDependency['type'] {
    const lower = filePath.toLowerCase()
    if (lower.includes('repository')) return 'repository'
    if (lower.includes('dto')) return 'dto'
    if (lower.includes('entity')) return 'entity'
    if (lower.includes('exception')) return 'exception'
    if (lower.includes('service')) return 'service'
    return 'other'
}

// ── Resolve one import to actual file path ──
function resolveImportPath(
    importSpecifier: string,
    currentFilePath: string,
    projectRoot: string
): string | null {
    let resolvedPath: string

    if (importSpecifier.startsWith('src/')) {
        resolvedPath = path.join(projectRoot, importSpecifier)
    } else if (importSpecifier.startsWith('.')) {
        resolvedPath = path.resolve(
            path.dirname(currentFilePath),
            importSpecifier
        )
    } else {
        return null
    }

    // ← ADD THIS CHECK FIRST
    // Skip if it's a directory
    if (fs.existsSync(resolvedPath) &&
        fs.statSync(resolvedPath).isDirectory()) {
        return null
    }

    // Try with .ts extension
    if (fs.existsSync(resolvedPath + '.ts')) {
        return resolvedPath + '.ts'
    }

    // Try as-is
    if (fs.existsSync(resolvedPath) &&
        fs.statSync(resolvedPath).isFile()) {  // ← check it's a file
        return resolvedPath
    }

    // Try index.ts
    const indexPath = path.join(resolvedPath, 'index.ts')
    if (fs.existsSync(indexPath)) {
        return indexPath
    }

    return null
}

// ── Recursively resolve dependencies ──
function resolveDependencies(
    sourceFilePath: string,
    projectRoot: string,
    visited: Set<string>,
    depth: number,
    maxDepth: number
): ResolvedDependency[] {
    if (depth > maxDepth) return []
    if (visited.has(sourceFilePath)) return []
    visited.add(sourceFilePath)

    const results: ResolvedDependency[] = []

    const project = new Project()
    const sourceFile = project.addSourceFileAtPath(sourceFilePath)

    sourceFile.getImportDeclarations().forEach(imp => {
        const specifier = imp.getModuleSpecifierValue()
        const resolvedPath = resolveImportPath(
            specifier,
            sourceFilePath,
            projectRoot
        )

        if (!resolvedPath) return

        const fileType = detectFileType(resolvedPath)

        // Prioritize important file types
        const importantTypes = ['repository', 'dto', 'entity', 'exception']
        if (depth > 0 && !importantTypes.includes(fileType)) return

        if (!visited.has(resolvedPath)) {
            if (!fs.statSync(resolvedPath).isFile()) return

            const content = fs.readFileSync(resolvedPath, 'utf8')

            results.push({
                filePath: resolvedPath,
                content,
                type: fileType
            })

            // Recurse only one more level for DTOs and entities
            if (depth < maxDepth) {
                const nested = resolveDependencies(
                    resolvedPath,
                    projectRoot,
                    visited,
                    depth + 1,
                    maxDepth
                )
                results.push(...nested)
            }
        }
    })

    return results
}

// ── Build context string for LLM ──
export function buildDependencyContext(
    sourceFilePath: string,
    projectRoot: string,
    maxDepth: number = 10,
    maxTokens: number = 56000
): string {
    const visited = new Set<string>()

    const dependencies = resolveDependencies(
        sourceFilePath,
        projectRoot,
        visited,
        0,
        maxDepth
    )
    if (dependencies.length === 0) return ''

    // Sort by priority — repositories and DTOs first
    const priority = {
        repository: 0,
        dto: 1,
        entity: 2,
        exception: 3,
        service: 4,
        other: 5
    }

    dependencies.sort((a, b) => priority[a.type] - priority[b.type])

    // Build context string
    const sections = dependencies.map(dep => {
        const relativePath = path.relative(projectRoot, dep.filePath)
        return `// ── ${dep.type.toUpperCase()}: ${relativePath} ──\n${dep.content}`
    })

    // Join and limit to maxTokens (rough estimate: 4 chars per token)
    const fullContext = sections.join('\n\n')
    const charLimit = maxTokens * 4

    if (fullContext.length > charLimit) {
        return fullContext.slice(0, charLimit) + '\n// ... (truncated)'
    }

    return fullContext
}