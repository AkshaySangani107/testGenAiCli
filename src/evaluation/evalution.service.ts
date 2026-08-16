import { runCompilationCheck } from './deterministic/compilation.evalutor'
import { runCoverageCheck } from './deterministic/coverage.evalutor'
import { runIntegrityCheck } from './deterministic/integrity.evalutor'
import { runJestCheck } from './deterministic/jest.evalutor'
import { CheckResult, EvaluationResult, EvaluationIssue } from './types'

interface EvaluationInput {
    sourceFilePath: string
    specFilePath: string
    projectRoot: string
}

export async function evaluate(
    input: EvaluationInput
): Promise<EvaluationResult> {

    // Step 1: Run all 4 evaluators

    const [compilation, jest, integrity, coverage] = await Promise.all([
        runCompilationCheck(input.sourceFilePath, input.projectRoot),
        runJestCheck(input.specFilePath, input.projectRoot),
        runIntegrityCheck(input.specFilePath),
        runCoverageCheck(input.sourceFilePath, input.specFilePath)
    ])

    // Step 2: Combine all checks

    const checks: CheckResult[] = [compilation, jest, integrity, coverage]

    // Step 3: Calculate total score

    const totalScore = checks.reduce((sum, check) => sum + check.score, 0)

    // Step 4: Check hard checks
    // compilation.passed && jest.passed

    const hardChecksPassed = compilation.passed && jest.passed
    // Step 5: Determine if accepted
    // hardChecksPassed && score >= 28

    const passed = hardChecksPassed && totalScore >= 28

    // Step 6: Collect all issues

    const issues: EvaluationIssue[] = []
    checks.forEach(check => {
        issues.push(...check.issues)
    })

    // Step 7: Return EvaluationResult

    return {
        passed,
        score: totalScore,
        maxScore: 40,
        checks,
        issues
    }
}