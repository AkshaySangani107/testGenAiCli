import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { evaluate } from '../evaluation/evaluation.service'
import { buildFeedback } from '../evaluation/feedback.builder'
import { buildDependencyContext } from '../resolver/dependency.resolver'
import { CoverageGapDetector } from '../coverage/gap.detector'
import { CoverageGapReport } from '../coverage/types'
import { SpecMerger } from '../coverage/spec.merger'

const MAX_ATTEMPTS = 3
const gapDetector = new CoverageGapDetector()

export interface RunnerInput {
    sourceFilePath: string
    projectRoot: string
    apiUrl: string
    minCoverage?: number
    expandOnly?: boolean
    onAttempt?: (attempt: number, score: number, statusMsg?: string) => void
}

export interface RunnerResult {
    specContent: string
    score: number
    maxScore: number
    accepted: boolean
    attempts: number
    coverageReport?: CoverageGapReport
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

// ── Expand spec via backend ──
async function expandSpec(
    fileContent: string,
    dependencyContext: string,
    existingSpec: string,
    uncoveredMethods: string[],
    uncoveredBranches: string[],
    apiUrl: string
): Promise<string> {
    const response = await axios.post(
        `${apiUrl}/generate/expand`,
        {
            sourceContent: fileContent,
            existingSpec,
            uncoveredMethods,
            uncoveredBranches,
            dependencyContext
        },
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
    const minCoverage = input.minCoverage ?? 75

    // Build Level-1 isolated dependency contract
    const dependencyContext = buildDependencyContext(
        input.sourceFilePath,
        input.projectRoot
    )

    let bestSpec = ''
    let bestScore = 0
    let previousSpec = ''
    let feedback: string[] = []
    let finalCoverageReport: CoverageGapReport | undefined

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        input.onAttempt?.(attempt, bestScore)

        // Step 1: Generate or Retry
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

            // Step 5: Check coverage gap if passed
            if (result.passed) {
                let currentReport = gapDetector.detectGaps(
                    input.sourceFilePath,
                    tempPath,
                    minCoverage
                )

                // If coverage gaps detected, attempt smart expansion
                if (!currentReport.meetsThreshold && currentReport.uncoveredMethods.length > 0) {
                    input.onAttempt?.(
                        attempt,
                        bestScore,
                        `Coverage gap: ${currentReport.overallCoveragePct}% (Target: ${minCoverage}%). Expanding for [${currentReport.uncoveredMethods.join(', ')}]...`
                    )

                    try {
                        const expansionCode = await expandSpec(
                            fileContent,
                            dependencyContext,
                            bestSpec,
                            currentReport.uncoveredMethods,
                            currentReport.uncoveredBranches.map(b => `${b.method}: ${b.condition} (${b.throwType || 'Error'})`),
                            input.apiUrl
                        )

                        const mergedCandidate = SpecMerger.merge(bestSpec, expansionCode)
                        const expandedTempPath = writeTempSpec(input.sourceFilePath, mergedCandidate)

                        try {
                            const expandedResult = await evaluate(
                                {
                                    sourceFilePath: input.sourceFilePath,
                                    specFilePath: expandedTempPath,
                                    projectRoot: input.projectRoot
                                },
                                input.apiUrl
                            )

                            if (expandedResult.passed && expandedResult.score >= bestScore) {
                                bestSpec = mergedCandidate
                                bestScore = expandedResult.score
                                currentReport = gapDetector.detectGaps(
                                    input.sourceFilePath,
                                    expandedTempPath,
                                    minCoverage
                                )
                            }
                        } finally {
                            cleanupTemp(expandedTempPath)
                        }
                    } catch {
                        // If expansion fails, retain existing working bestSpec
                    }
                }

                finalCoverageReport = currentReport

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
                    attempts: attempt,
                    coverageReport: finalCoverageReport
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
        attempts: MAX_ATTEMPTS,
        coverageReport: finalCoverageReport
    }
}