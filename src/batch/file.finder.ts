import * as fs from 'fs'
import * as path from 'path'

export interface FindFilesOptions {
    rootDir: string
    pattern?: string
    onlyMissing?: boolean
}

/**
 * Normalizes glob-like wildcards or relative paths into regex matching.
 * Supports patterns like:
 * - src/
 * - **\/*.service.ts
 * - src/modules/**\/*.service.ts
 * - user.service.ts
 */
function patternToRegex(pattern: string): RegExp {
    // If it's a directory path ending with / or without extension
    if (pattern.endsWith('/') || !path.extname(pattern)) {
        const clean = pattern.replace(/\/+$/, '')
        return new RegExp(`^${escapeRegex(clean)}(?:/.*)?\\.ts$`)
    }

    const regexString = pattern
        .replace(/\\/g, '/')
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '§§GLOBSTAR§§')
        .replace(/\*/g, '[^/]*')
        .replace(/§§GLOBSTAR§§/g, '.*')

    return new RegExp(`${regexString}$`)
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Recursively discovers TypeScript files matching constraints.
 * Skips node_modules, dist, .git, and temporary files.
 */
export function discoverTargetFiles(options: FindFilesOptions): string[] {
    const { rootDir, pattern, onlyMissing = false } = options
    const resolvedRoot = path.resolve(process.cwd(), rootDir)

    if (!fs.existsSync(resolvedRoot)) {
        return []
    }

    const regex = pattern ? patternToRegex(pattern) : /\.service\.ts$/

    const matchedFiles: string[] = []

    function walk(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
                // Ignore standard non-source directories
                if (
                    entry.name === 'node_modules' ||
                    entry.name === 'dist' ||
                    entry.name === '.git' ||
                    entry.name === 'coverage' ||
                    entry.name === '.next' ||
                    entry.name === '.turbo'
                ) {
                    continue
                }
                walk(fullPath)
            } else if (entry.isFile()) {
                // Ignore spec, test, temporary, declaration files
                if (
                    entry.name.endsWith('.spec.ts') ||
                    entry.name.endsWith('.test.ts') ||
                    entry.name.endsWith('.spec.tmp.ts') ||
                    entry.name.endsWith('.d.ts')
                ) {
                    continue
                }

                if (!entry.name.endsWith('.ts')) {
                    continue
                }

                // Check relative path against pattern
                const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/')
                const normalizedFullPath = fullPath.replace(/\\/g, '/')

                const matches = regex.test(relativePath) || regex.test(normalizedFullPath) || regex.test(entry.name)

                if (matches) {
                    if (onlyMissing) {
                        const parsed = path.parse(fullPath)
                        const specFile = path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`)
                        if (fs.existsSync(specFile)) {
                            continue
                        }
                    }
                    matchedFiles.push(fullPath)
                }
            }
        }
    }

    const stat = fs.statSync(resolvedRoot)
    if (stat.isFile()) {
        matchedFiles.push(resolvedRoot)
    } else {
        walk(resolvedRoot)
    }

    return matchedFiles.sort()
}
