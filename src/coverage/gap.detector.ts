import * as fs from 'fs'
import { Project, SyntaxKind, ClassDeclaration, MethodDeclaration, IfStatement, ThrowStatement } from 'ts-morph'
import { BranchGapInfo, CoverageGapReport, MethodGapInfo } from './types'

export class CoverageGapDetector {
    private readonly project: Project

    constructor() {
        this.project = new Project({
            useInMemoryFileSystem: false,
            compilerOptions: { allowJs: true }
        })
    }

    public detectGaps(
        sourceFilePath: string,
        specFilePath: string,
        minCoverage = 75
    ): CoverageGapReport {
        const sourceFile = this.project.addSourceFileAtPath(sourceFilePath)
        const classes = sourceFile.getClasses()
        const primaryClass = classes[0]

        if (!primaryClass) {
            return this.buildEmptyReport()
        }

        const methods = this.extractPublicMethods(primaryClass)
        const branches = this.extractBranches(primaryClass)

        // Read spec content to analyze calls
        const specContent = fs.existsSync(specFilePath)
            ? fs.readFileSync(specFilePath, 'utf8')
            : ''

        const methodInfos = this.analyzeMethods(methods, specContent)
        const branchInfos = this.analyzeBranches(branches, specContent)

        const testedMethods = methodInfos.filter(m => m.tested)
        const uncoveredMethods = methodInfos.filter(m => !m.tested).map(m => m.name)

        const totalMethods = methodInfos.length
        const testedCount = testedMethods.length
        const methodCoveragePct = totalMethods > 0
            ? Math.round((testedCount / totalMethods) * 100)
            : 100

        const totalBranches = branchInfos.length
        const uncoveredBranches = branchInfos.filter(b => !b.tested)
        const coveredBranchesCount = totalBranches - uncoveredBranches.length
        const branchCoveragePct = totalBranches > 0
            ? Math.round((coveredBranchesCount / totalBranches) * 100)
            : 100

        // Weighted overall score: 70% method coverage + 30% branch coverage
        const overallCoveragePct = totalBranches > 0
            ? Math.round(methodCoveragePct * 0.7 + branchCoveragePct * 0.3)
            : methodCoveragePct

        const meetsThreshold = overallCoveragePct >= minCoverage

        return {
            totalMethods,
            testedMethodsCount: testedCount,
            uncoveredMethods,
            methodCoveragePct,
            totalBranches,
            branches: branchInfos,
            uncoveredBranches,
            branchCoveragePct,
            overallCoveragePct,
            meetsThreshold,
        }
    }

    private extractPublicMethods(cls: ClassDeclaration): MethodDeclaration[] {
        return cls.getMethods().filter(m => {
            const name = m.getName()
            // Ignore private/protected or constructor/lifecycle hooks
            if (name.startsWith('_') || name.startsWith('#')) return false
            if (['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy'].includes(name)) return false
            const scope = m.getScope()
            return scope !== 'private' && scope !== 'protected'
        })
    }

    private extractBranches(cls: ClassDeclaration): BranchGapInfo[] {
        const branches: BranchGapInfo[] = []

        cls.getMethods().forEach(m => {
            const methodName = m.getName()
            const ifStatements = m.getDescendantsOfKind(SyntaxKind.IfStatement)

            ifStatements.forEach((ifStmt: IfStatement) => {
                const condition = ifStmt.getExpression().getText()
                const throwStatements = ifStmt.getDescendantsOfKind(SyntaxKind.ThrowStatement)

                if (throwStatements.length > 0) {
                    const firstThrow: ThrowStatement = throwStatements[0]
                    const throwText = firstThrow.getExpression()?.getText() || 'Error'
                    const match = throwText.match(/new\s+([A-Za-z0-9_]+Exception|Error)/)
                    const throwType = match ? match[1] : 'Error'

                    branches.push({
                        method: methodName,
                        condition: condition.slice(0, 60),
                        type: 'guard_throw',
                        throwType,
                        tested: false
                    })
                } else {
                    branches.push({
                        method: methodName,
                        condition: condition.slice(0, 60),
                        type: 'if_branch',
                        tested: false
                    })
                }
            })

            // Catch clauses
            const catchClauses = m.getDescendantsOfKind(SyntaxKind.CatchClause)
            if (catchClauses.length > 0) {
                branches.push({
                    method: methodName,
                    condition: 'catch(error)',
                    type: 'catch_block',
                    tested: false
                })
            }
        })

        return branches
    }

    private analyzeMethods(methods: MethodDeclaration[], specContent: string): MethodGapInfo[] {
        return methods.map(m => {
            const name = m.getName()
            const isAsync = m.isAsync()

            // Look for service invocation: service.methodName( or describe('methodName' or it('...methodName
            const regexInvocation = new RegExp(`\\.${name}\\s*\\(`, 'g')
            const regexBlock = new RegExp(`['"\`]\\s*(?:should\\s+)?(?:test\\s+)?${name}['"\`]`, 'i')

            const matches = specContent.match(regexInvocation)
            const callCount = matches ? matches.length : 0
            const blockFound = regexBlock.test(specContent)

            const tested = callCount > 0 || blockFound

            return {
                name,
                isAsync,
                tested,
                callCount
            }
        })
    }

    private analyzeBranches(branches: BranchGapInfo[], specContent: string): BranchGapInfo[] {
        return branches.map(b => {
            let tested = false

            if (b.type === 'guard_throw' && b.throwType) {
                // Check if the spec tests throwing this exception
                const testsThrow =
                    specContent.includes(b.throwType) &&
                    (specContent.includes('toThrow') || specContent.includes('rejects'))
                tested = testsThrow
            } else if (b.type === 'catch_block') {
                tested = specContent.includes('rejects') || specContent.includes('catch')
            } else {
                // Generic branch tested if method has multiple test blocks
                const methodMatches = specContent.match(new RegExp(`\\.${b.method}\\s*\\(`, 'g'))
                tested = Boolean(methodMatches && methodMatches.length > 1)
            }

            return {
                ...b,
                tested
            }
        })
    }

    private buildEmptyReport(): CoverageGapReport {
        return {
            totalMethods: 0,
            testedMethodsCount: 0,
            uncoveredMethods: [],
            methodCoveragePct: 100,
            totalBranches: 0,
            branches: [],
            uncoveredBranches: [],
            branchCoveragePct: 100,
            overallCoveragePct: 100,
            meetsThreshold: true
        }
    }
}
