import { CheckResult, EvaluationIssue } from '../types'
import { CoverageGapDetector } from '../../coverage/gap.detector'

const gapDetector = new CoverageGapDetector()

export async function runCoverageCheck(
    sourceFilePath: string,
    specFilePath: string,
    minCoverage = 70
): Promise<CheckResult> {
    const report = gapDetector.detectGaps(sourceFilePath, specFilePath, minCoverage)

    const issues: EvaluationIssue[] = []

    // Report untested methods
    report.uncoveredMethods.forEach(method => {
        issues.push({
            category: 'test-coverage',
            severity: 'high',
            message: `Method ${method} is not covered in test suite`
        })
    })

    // Report critical uncovered guard/error branches
    report.uncoveredBranches.forEach(branch => {
        if (branch.type === 'guard_throw') {
            issues.push({
                category: 'test-coverage',
                severity: 'medium',
                message: `Method ${branch.method} does not test error guard condition '${branch.condition}' (${branch.throwType || 'Error'})`
            })
        }
    })

    // Calculate score out of 10
    const score = Math.round((report.overallCoveragePct / 100) * 10)
    const passed = report.meetsThreshold && report.uncoveredMethods.length === 0

    return {
        name: 'test-coverage',
        passed,
        score,
        maxScore: 10,
        issues
    }
}
