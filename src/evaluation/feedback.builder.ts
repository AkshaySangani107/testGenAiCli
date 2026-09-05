import { EvaluationIssue, EvaluationResult } from "./types"

export interface GenerationFeedback {
    attempt: number
    score: number
    maxScore: number
    passed: boolean
    feedback: string[]
}

// ── Build feedback from evaluation result ──
export function buildFeedback(
    result: EvaluationResult,
    attempt: number
): GenerationFeedback {
    const rawFeedback = getActionableInstructions(result)

    // Extract TS error code from message
    const extractCode = (msg: string): string => {
        const match = msg.match(/TS\d+/)
        return match ? match[0] : msg
    }

    const seen = new Set<string>()
    const feedback = rawFeedback.filter(item => {
        const key = extractCode(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    return {
        attempt,
        score: result.score,
        maxScore: result.maxScore,
        passed: result.passed,
        feedback
    }
}


// ── Convert single issue to actionable instruction ──
function issueToInstruction(issue: EvaluationIssue): string {
    switch (issue.category) {
        case 'compilation':
            return `Fix compilation errors in the test file. ${issue.message}`

        case 'test-coverage':
            return `Improve test coverage by adding test cases for uncovered code paths. ${issue.message}`

        case 'test-integrity':
            return `Ensure test integrity by verifying that tests validate actual behavior rather than only execution. ${issue.message}`

        case 'test-assertion':
            return `Improve test assertions by verifying expected outputs, side effects, and error conditions. ${issue.message}`

        case 'test-runtime':
            return `Fix test runtime issues so the test suite executes successfully and reliably. ${issue.message}`

        case 'mocking':
            return `Improve mocking by correctly mocking external dependencies and controlling their behavior. ${issue.message}`

        case 'assertion':
            return `Strengthen assertions so each test verifies meaningful expected behavior. ${issue.message}`

        case 'async':
            return `Fix asynchronous test handling by properly awaiting promises and handling async success and failure paths. ${issue.message}`

        case 'patterns':
            return `Follow the established testing patterns and project conventions. ${issue.message}`

        case 'maintainability':
            return `Improve test maintainability by reducing duplication and keeping test setup and assertions clear. ${issue.message}`
            
        case 'test-runtime':
            return `Fix test runtime issue: ${issue.message}. Verify that mocked methods are actually called by the service. If service has no external dependencies, do not mock anything — 
            instantiate the service directly with new ServiceName().`

        default:
            return `Fix the following test issue: ${issue.message}`
    }
}

// ── Convert all issues into actionable instructions ──
function getActionableInstructions(
    result: EvaluationResult
): string[] {

    // Group issues by category
    const grouped = result.issues.reduce((acc, issue) => {
        if (!acc[issue.category]) acc[issue.category] = []
        acc[issue.category].push(issue)
        return acc
    }, {} as Record<string, EvaluationIssue[]>)

    const instructions: string[] = []

    for (const [category, issues] of Object.entries(grouped)) {
        if (category === 'compilation') {
            // Get unique error codes only
            const uniqueErrors = [...new Set(
                issues.map(i => {
                    const match = i.message.match(/\[(TS\d+)\]/)
                    return match ? match[1] : i.message
                })
            )]

            // Check for @types/jest specifically
            const missingJest = issues.some(i =>
                i.message.includes('describe') ||
                i.message.includes('@types/jest')
            )

            if (missingJest) {
                instructions.push(
                    'Add @types/jest import or ensure jest types are available. ' +
                    'The spec uses jest, describe, it, expect but types are not resolved.'
                )
            }

            // Wrong imports
            const wrongImports = issues
                .filter(i => i.message.includes('TS2307'))
                .map(i => i.message)
                .filter((v, i, a) => a.indexOf(v) === i) // unique

            wrongImports.forEach(msg => {
                instructions.push(`Fix compilation error: ${msg}`)
            })

            // Missing names (not jest-related)
            const missingNames = issues
                .filter(i =>
                    i.message.includes('TS2304') &&
                    !i.message.includes('jest') &&
                    !i.message.includes('expect') &&
                    !i.message.includes('describe') &&
                    !i.message.includes('beforeEach')
                )
                .map(i => i.message)
                .filter((v, i, a) => a.indexOf(v) === i)

            missingNames.forEach(msg => {
                instructions.push(`Fix missing name: ${msg}`)
            })

        } else {
            // Other categories — deduplicate by message
            const unique = [...new Set(issues.map(i => i.message))]
            unique.forEach(msg => {
                instructions.push(issueToInstruction({
                    category,
                    severity: 'high',
                    message: msg
                }))
            })
        }
    }

    return instructions
}