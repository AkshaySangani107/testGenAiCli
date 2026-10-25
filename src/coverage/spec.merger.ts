export class SpecMerger {
    /**
     * Stitches expansion test blocks into an existing test spec file cleanly.
     */
    public static merge(existingSpec: string, expansionCode: string): string {
        const cleanedExisting = existingSpec.trim()
        const cleanedExpansion = expansionCode.trim()

        if (!cleanedExpansion) {
            return cleanedExisting
        }

        // 1. Separate any imports inside expansion code from test blocks
        const expansionLines = cleanedExpansion.split('\n')
        const newImports: string[] = []
        const testBlockLines: string[] = []

        expansionLines.forEach(line => {
            const trimmed = line.trim()
            if (trimmed.startsWith('import ') && (trimmed.endsWith(';') || trimmed.includes('from '))) {
                newImports.push(line)
            } else {
                testBlockLines.push(line)
            }
        })

        // 2. Merge imports into existing spec at the top if not already present
        let updatedSpec = cleanedExisting
        if (newImports.length > 0) {
            const missingImports = newImports.filter(imp => {
                const match = imp.match(/import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+))\s+from/)
                if (match) {
                    const identifiers = (match[1] || match[2] || '').split(',').map(s => s.trim())
                    return !identifiers.some(id => id && updatedSpec.includes(id))
                }
                return !updatedSpec.includes(imp.trim())
            })

            if (missingImports.length > 0) {
                updatedSpec = `${missingImports.join('\n')}\n${updatedSpec}`
            }
        }

        // 3. Find the final closing of the root describe block
        const testBlocksCode = testBlockLines.join('\n').trim()
        if (!testBlocksCode) {
            return updatedSpec
        }

        const lastCloseIndex = updatedSpec.lastIndexOf('});')
        if (lastCloseIndex !== -1) {
            const beforeClose = updatedSpec.slice(0, lastCloseIndex).trimEnd()
            const afterClose = updatedSpec.slice(lastCloseIndex)

            return `${beforeClose}\n\n    // ── Expansion Tests (Coverage Gap Closes) ──\n    ${testBlocksCode.split('\n').join('\n    ')}\n${afterClose}`
        }

        // Fallback: If no closing found, append
        return `${updatedSpec}\n\n${testBlocksCode}\n`
    }
}
