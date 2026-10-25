import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { evaluate } from '../evaluation/evaluation.service'
import { buildFeedback } from '../evaluation/feedback.builder'
import { buildDependencyContext } from '../resolver/dependency.resolver'

const MAX_ATTEMPTS = 3
const ACCEPTANCE_THRESHOLD = 48

interface RunnerInput {
    sourceFilePath: string
    projectRoot: string
    apiUrl: string
    onAttempt?: (attempt: number, score: number) => void
}

interface RunnerResult {
    specContent: string
    score: number
    maxScore: number
    accepted: boolean
    attempts: number
}

// ── Generate spec via backend ──
async function generateSpec(
    fileContent: string,
    dependencyContext: string,
    apiUrl: string
): Promise<string> {
    const response = await axios.post(
        `${apiUrl}/generate`,
        { fileContent, dependencyContext },
        { timeout: 180000 }
    )
    return response.data
}

// ── Retry spec via backend ──
async function retrySpec(
    fileContent: string,
    dependencyContext: string,
    previousSpec: string,
    feedback: string[],
    apiUrl: string
): Promise<string> {
    const response = await axios.post(
        `${apiUrl}/generate/retry`,
        { fileContent, dependencyContext, previousSpec, feedback },
        { timeout: 180000 }
    )
    return response.data
}

// ── Write temp spec file ──
function writeTempSpec(
    sourceFilePath: string,
    specContent: string
): string {
    const parsed = path.parse(sourceFilePath)
    const tempPath = path.join(
        parsed.dir,
        `${parsed.name}.spec.tmp.ts`
    )
    fs.writeFileSync(tempPath, specContent)
    return tempPath
}

// ── Cleanup temp file ──
function cleanupTemp(tempPath: string): void {
    try {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath)
        }
    } catch {
        // silently ignore
    }
}

// ── Main generation loop ──
export async function runGenerationLoop(
    input: RunnerInput
): Promise<RunnerResult> {

    const fileContent = fs.readFileSync(input.sourceFilePath, 'utf8')

    // Build Level-1 isolated dependency contract
    const dependencyContext = buildDependencyContext(
        input.sourceFilePath,
        input.projectRoot
    )

    let bestSpec = ''
    let bestScore = 0
    let previousSpec = ''
    let feedback: string[] = []

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {

        input.onAttempt?.(attempt, bestScore)

        // Step 1: Generate
        const specContent = attempt === 1
            ? await generateSpec(fileContent, dependencyContext, input.apiUrl)
            : await retrySpec(
                fileContent,
                dependencyContext,
                previousSpec,
                feedback,
                input.apiUrl
            )

        // Step 2: Write temp file
        const tempPath = writeTempSpec(input.sourceFilePath, specContent)

        try {
            // Step 3: Evaluate
            const result = await evaluate(
                {
                    sourceFilePath: input.sourceFilePath,
                    specFilePath: tempPath,
                    projectRoot: input.projectRoot
                },
                input.apiUrl
            )

            // Step 4: Track best
            if (result.score > bestScore) {
                bestScore = result.score
                bestSpec = specContent
            }

            // Step 5: Accept or retry
            if (result.passed) {
                // Asynchronously save to spec cache in backend
                axios.post(`${input.apiUrl}/generate/cache/save`, {
                    sourceContent: fileContent,
                    className: path.parse(input.sourceFilePath).name,
                    specContent: bestSpec,
                    score: bestScore,
                    attempts: attempt,
                }).catch(() => {/* non-blocking cache write */})

                return {
                    specContent: bestSpec,
                    score: bestScore,
                    maxScore: result.maxScore,
                    accepted: true,
                    attempts: attempt
                }
            }

            // Step 6: Build feedback for next attempt
            const feedbackResult = buildFeedback(result, attempt)
            previousSpec = specContent
            feedback = feedbackResult.feedback

        } finally {
            cleanupTemp(tempPath)
        }
    }

    return {
        specContent: bestSpec,
        score: bestScore,
        maxScore: 80,
        accepted: false,
        attempts: MAX_ATTEMPTS
    }
}