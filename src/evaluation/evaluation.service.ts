import { runCompilationCheck } from './deterministic/compilation.evaluator'
import { runCoverageCheck } from './deterministic/coverage.evaluator'
import { runIntegrityCheck } from './deterministic/integrity.evaluator'
import { runJestCheck } from './deterministic/jest.evaluator'
import { runQualityCheck } from './llm/quality.evaluator'
import { CheckResult, EvaluationResult, EvaluationIssue } from './types'

interface EvaluationInput {
    sourceFilePath: string
    specFilePath: string
    projectRoot: string
}

export async function evaluate(
    input: EvaluationInput,
    apiUrl: string  // ← add this parameter
): Promise<EvaluationResult> {

    // Run deterministic checks in parallel
    const [compilation, jest, integrity, coverage] = await Promise.all([
        runCompilationCheck(input.specFilePath, input.projectRoot),
        runJestCheck(input.specFilePath, input.projectRoot),
        runIntegrityCheck(input.specFilePath),
        runCoverageCheck(input.sourceFilePath, input.specFilePath)
    ])

    const hardChecksPassed = compilation.passed && jest.passed

    // Only run LLM evaluator if hard checks passp
    // No point evaluating quality if it doesn't even compile
    let quality: CheckResult = {
        name: 'llm-quality',
        passed: false,
        score: 0,
        maxScore: 45,
        issues: []
    }

    if (hardChecksPassed) {
        quality = await runQualityCheck(
            input.sourceFilePath,
            input.specFilePath,
            apiUrl
        )
    }

    const checks: CheckResult[] = [
        compilation,
        jest,
        integrity,
        coverage,
        quality
    ]

    const totalScore = checks.reduce((sum, c) => sum + c.score, 0)
    const passed = hardChecksPassed && totalScore >= 48

    const issues: EvaluationIssue[] = []
    checks.forEach(c => issues.push(...c.issues))

    return {
        passed,
        score: totalScore,
        maxScore: 80,
        checks,
        issues
    }
}
