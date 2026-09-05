import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { evaluate } from '../evaluation/evaluation.service'
import { buildFeedback } from '../evaluation/feedback.builder'

const MAX_ATTEMPTS = 3
const ACCEPTANCE_THRESHOLD = 64

interface RunnerInput {
    sourceFilePath: string
    projectRoot: string
    apiUrl: string
    onAttempt?: (attempt: number, score: number) => void  // ← add

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
    apiUrl: string
): Promise<string> {
    // YOUR CODE HERE
    const response = await axios.post(`${apiUrl}/generate`, {
        fileContent
    }, {
        timeout: 180000,
        headers: { 'Connection': 'close' }
    });
    return response.data;
    // POST /generate with fileContent
    // return response.data
}

// ── Retry spec via backend ──
async function retrySpec(
    fileContent: string,
    previousSpec: string,
    feedback: string[],
    apiUrl: string
): Promise<string> {
    // YOUR CODE HERE
    // POST /generate/retry with fileContent + previousSpec + feedback
    const response = await axios.post(`${apiUrl}/generate/retry`, {
        fileContent,
        previousSpec,
        feedback
    }, {
        timeout: 180000,
        headers: { 'Connection': 'close' }
    });
    return response.data;
}

// ── Write temp spec file ──
function writeTempSpec(
    sourceFilePath: string,
    specContent: string
): string {
    // YOUR CODE HERE
    const parsed = path.parse(sourceFilePath)
    const tempPath = path.join(
        parsed.dir,
        `${parsed.name}.spec.tmp.ts`  // ← valid .ts extension
    )
    fs.writeFileSync(tempPath, specContent)
    return tempPath
}

// ── Cleanup temp file ──
function cleanupTemp(tempPath: string): void {
    // YOUR CODE HERE
    try {
        fs.unlinkSync(tempPath)
    } catch (e) {
        // ignore
    }
}

// ── Main generation loop ──
export async function runGenerationLoop(
    input: RunnerInput
): Promise<RunnerResult> {

    const fileContent = fs.readFileSync(input.sourceFilePath, 'utf8')

    let bestSpec = ''
    let bestScore = 0
    let previousSpec = ''
    let feedback: string[] = []

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        input.onAttempt?.(attempt, bestScore)  // ← add at start of loop


        // Step 1: Generate
        const specContent = attempt === 1
            ? await generateSpec(fileContent, input.apiUrl)
            : await retrySpec(fileContent, previousSpec, feedback, input.apiUrl)

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

    // All attempts exhausted — return best
    return {
        specContent: bestSpec,
        score: bestScore,
        maxScore: 80,
        accepted: false,
        attempts: MAX_ATTEMPTS
    }
}