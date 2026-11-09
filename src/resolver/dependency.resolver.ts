import * as fs from 'fs'
import * as path from 'path'
import { Project, SyntaxKind } from 'ts-morph'
import { MockFactoryGenerator, MockFactoryDefinition } from './mock.factory'

export interface DependencyMockContract {
    paramName: string
    typeName: string
    isCustomProvider?: boolean
    methodsCalled: string[]
    factory?: MockFactoryDefinition
}

export interface DirectTypeContract {
    typeName: string
    type: 'dto' | 'entity'
    relativePath: string
    properties: string[]
}

// ── Resolve import to actual file path ──
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

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        const indexPath = path.join(resolvedPath, 'index.ts')
        if (fs.existsSync(indexPath)) return indexPath
        return null
    }

    if (fs.existsSync(resolvedPath + '.ts')) {
        return resolvedPath + '.ts'
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        return resolvedPath
    }

    const indexPath = path.join(resolvedPath, 'index.ts')
    if (fs.existsSync(indexPath)) {
        return indexPath
    }

    return null
}

// ── Extract Level-1 Injected Dependency Method Contracts with Auto-Mock Factories ──
export function extractLevel1DependencyContracts(
    sourceFilePath: string
): DependencyMockContract[] {
    const project = new Project({ useInMemoryFileSystem: true })
    const content = fs.readFileSync(sourceFilePath, 'utf8')
    const sourceFile = project.createSourceFile('target.ts', content)

    const cls = sourceFile.getClasses()[0]
    if (!cls) return []

    const ctor = cls.getConstructors()[0]
    if (!ctor) return []

    const deps = ctor.getParameters().map(p => {
        const name = p.getName()
        const typeNode = p.getTypeNode()
        const typeName = typeNode ? typeNode.getText().trim() : p.getType().getText().trim()
        
        // Extract parameter decorators with arguments (e.g. @InjectRepository(User), @Inject(CACHE_MANAGER))
        const decorators = p.getDecorators().map(d => ({
            name: d.getName(),
            args: d.getArguments().map(a => a.getText().trim())
        }))

        const isMapper = typeName.toLowerCase().includes('mapper') || decorators.some(d => d.name.includes('Mapper'))

        return {
            paramName: name,
            typeName,
            decorators,
            isCustomProvider: isMapper
        }
    })

    const callsByDep: Record<string, Set<string>> = {}
    for (const d of deps) {
        callsByDep[d.paramName] = new Set<string>()
    }

    // Inspect all methods in the target class for calls on this.<paramName>.<methodName>()
    cls.getMethods().forEach(method => {
        method.forEachDescendant(node => {
            if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
                const expr = node.asKind(SyntaxKind.PropertyAccessExpression)
                if (!expr) return

                const leftText = expr.getExpression().getText()
                const methodName = expr.getName()

                for (const d of deps) {
                    if (leftText === `this.${d.paramName}` || leftText === `this?.${d.paramName}`) {
                        callsByDep[d.paramName].add(methodName)
                    }
                }
            }
        })
    })

    return deps.map(d => {
        const methodsCalled = Array.from(callsByDep[d.paramName] || [])
        const factory = MockFactoryGenerator.generateFactory(
            d.paramName,
            d.typeName,
            d.decorators,
            methodsCalled
        )

        return {
            paramName: d.paramName,
            typeName: d.typeName,
            isCustomProvider: d.isCustomProvider,
            methodsCalled,
            factory
        }
    })
}

// ── Extract Direct Level-1 DTO & Entity Signatures (Non-transitive) ──
export function extractLevel1TypeContracts(
    sourceFilePath: string,
    projectRoot: string
): DirectTypeContract[] {
    const project = new Project()
    const sourceFile = project.addSourceFileAtPath(sourceFilePath)
    const contracts: DirectTypeContract[] = []

    sourceFile.getImportDeclarations().forEach(imp => {
        const specifier = imp.getModuleSpecifierValue()
        const resolvedPath = resolveImportPath(specifier, sourceFilePath, projectRoot)
        if (!resolvedPath || !fs.existsSync(resolvedPath)) return

        const lower = resolvedPath.toLowerCase()
        const isDto = lower.includes('dto')
        const isEntity = lower.includes('entity')

        if (!isDto && !isEntity) return

        try {
            const impProject = new Project({ useInMemoryFileSystem: true })
            const impContent = fs.readFileSync(resolvedPath, 'utf8')
            const impSourceFile = impProject.createSourceFile('type.ts', impContent)

            impSourceFile.getClasses().forEach(c => {
                const typeName = c.getName()
                if (!typeName) return
                const properties = c.getProperties().map(p => p.getName())
                contracts.push({
                    typeName,
                    type: isDto ? 'dto' : 'entity',
                    relativePath: path.relative(projectRoot, resolvedPath),
                    properties
                })
            })
        } catch {
            // Ignore parse errors on external files
        }
    })

    return contracts
}

// ── Build Clean, High-Precision Level-1 Mock Specification ──
export function buildDependencyContext(
    sourceFilePath: string,
    projectRoot: string
): string {
    const depContracts = extractLevel1DependencyContracts(sourceFilePath)
    const typeContracts = extractLevel1TypeContracts(sourceFilePath, projectRoot)

    if (depContracts.length === 0 && typeContracts.length === 0) {
        return ''
    }

    const lines: string[] = []
    lines.push('=== LEVEL-1 ISOLATED DEPENDENCY CONTRACT (MOCK BOUNDARY) ===')
    lines.push('CRITICAL: ONLY mock these direct dependencies. DO NOT import or provide nested/transitive dependencies.')
    lines.push('')

    lines.push('--- INJECTED SERVICES & REPOSITORIES (USE THESE EXACT PRE-BUILT MOCK FIXTURES) ---')
    for (const dep of depContracts) {
        if (dep.factory) {
            lines.push(`- Injected: this.${dep.paramName} (${dep.typeName}) [Decorator: ${dep.factory.decoratorType}]`)
            if (dep.methodsCalled.length > 0) {
                lines.push(`  Methods invoked by service: ${dep.methodsCalled.join(', ')}`)
            }
            lines.push(`  MOCK FIXTURE CODE:`)
            lines.push(`  ${dep.factory.mockFactoryCode.split('\n').join('\n  ')}`)
            lines.push(`  MODULE PROVIDER:`)
            lines.push(`  ${dep.factory.providerDefinition}`)
            if (dep.factory.requiredImports.length > 0) {
                lines.push(`  Required Imports: ${dep.factory.requiredImports.join(', ')}`)
            }
        }
        lines.push('')
    }

    if (typeContracts.length > 0) {
        lines.push('--- DIRECT DTOs & ENTITIES (SHALLOW PROPERTY REFERENCE) ---')
        lines.push('Always cast mocks using: const dto = { ... } as unknown as DtoType;')
        for (const tc of typeContracts.slice(0, 10)) {
            lines.push(`- ${tc.typeName} (${tc.type.toUpperCase()} from ${tc.relativePath}): [${tc.properties.slice(0, 8).join(', ')}]`)
        }
    }

    return lines.join('\n')
}