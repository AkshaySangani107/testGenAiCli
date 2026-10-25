import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { runGenerationLoop } from '../generation/generation.runner'

export interface BatchOptions {
    files: string[]
    projectRoot: string
    apiUrl: string
    outputDir?: string
    dryRun?: boolean
    yes?: boolean
    concurrency?: number
    minCoverage?: number
}

export interface FileResult {
    file: string
    specPath: string
    score: number
    maxScore: number
    attempts: number
    accepted: boolean
    skipped?: boolean
    error?: string
}

export interface BatchSummary {
    total: number
    passed: number
    failed: number
    skipped: number
    durationMs: number
    results: FileResult[]
}

/**
 * Finds project root by walking up directories from a file
 */
export function findProjectRoot(filePath: string): string | null {
    let dir = path.dirname(filePath)
    while (dir !== path.parse(dir).root) {
        if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
            return dir
        }
        dir = path.dirname(dir)
    }
    return null
}

/**
 * Runs batch generation across all discovered files with progress tracking
 */
export async function runBatch(options: BatchOptions): Promise<BatchSummary> {
    const { files, apiUrl, outputDir, dryRun, yes, concurrency = 1 } = options
    const startTime = Date.now()
    const results: FileResult[] = []

    console.log(chalk.bold.blue(`\n🚀 Starting Batch Test Generation for ${files.length} file(s)`))
    console.log(chalk.gray(`Concurrency: ${concurrency} | Dry Run: ${Boolean(dryRun)} | Overwrite All: ${Boolean(yes)}\n`))

    let processed = 0

    // Process files with bounded concurrency
    const queue = [...files]

    async function worker(workerId: number): Promise<void> {
        while (queue.length > 0) {
            const currentFile = queue.shift()
            if (!currentFile) break

            processed++
            const currentCount = processed
            const fileName = path.basename(currentFile)
            const root = options.projectRoot || findProjectRoot(currentFile)

            if (!root) {
                results.push({
                    file: currentFile,
                    specPath: '',
                    score: 0,
                    maxScore: 80,
                    attempts: 0,
                    accepted: false,
                    error: 'Could not find tsconfig.json project root',
                })
                continue
            }

            const parsed = path.parse(currentFile)
            const targetDir = outputDir ? path.resolve(process.cwd(), outputDir) : parsed.dir
            const specPath = path.join(targetDir, `${parsed.name}.spec${parsed.ext}`)

            const spinner = ora(
                `[${currentCount}/${files.length}] Generating for ${chalk.cyan(fileName)}...`
            ).start()

            try {
                const loopResult = await runGenerationLoop({
                    sourceFilePath: currentFile,
                    projectRoot: root,
                    apiUrl,
                    minCoverage: options.minCoverage,
                    onAttempt: (attempt, score) => {
                        if (attempt > 1) {
                            spinner.text = `[${currentCount}/${files.length}] Refining ${chalk.cyan(fileName)} (attempt ${attempt}, score: ${score}/80)...`
                        }
                    },
                })

                if (loopResult.accepted) {
                    spinner.succeed(
                        `[${currentCount}/${files.length}] ${chalk.green(fileName)} - Score: ${loopResult.score}/${loopResult.maxScore} (attempt ${loopResult.attempts})`
                    )
                } else {
                    spinner.warn(
                        `[${currentCount}/${files.length}] ${chalk.yellow(fileName)} - Score: ${loopResult.score}/${loopResult.maxScore} (best attempt used)`
                    )
                }

                if (!dryRun) {
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true })
                    }
                    fs.writeFileSync(specPath, loopResult.specContent, 'utf8')
                }

                results.push({
                    file: currentFile,
                    specPath,
                    score: loopResult.score,
                    maxScore: loopResult.maxScore,
                    attempts: loopResult.attempts,
                    accepted: loopResult.accepted,
                })
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err)
                spinner.fail(`[${currentCount}/${files.length}] ${chalk.red(fileName)} - Failed: ${errMsg}`)
                results.push({
                    file: currentFile,
                    specPath,
                    score: 0,
                    maxScore: 80,
                    attempts: 0,
                    accepted: false,
                    error: errMsg,
                })
            }

            // Polite pause between files to stay safely within free-tier burst limits
            if (queue.length > 0) {
                await new Promise((resolve) => setTimeout(resolve, 2000))
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, files.length) }, (_, i) => worker(i + 1))
    await Promise.all(workers)

    const durationMs = Date.now() - startTime
    const passed = results.filter((r) => r.accepted).length
    const failed = results.filter((r) => !r.accepted && !r.skipped).length
    const skipped = results.filter((r) => r.skipped).length

    printSummaryTable({
        total: files.length,
        passed,
        failed,
        skipped,
        durationMs,
        results,
    })

    return {
        total: files.length,
        passed,
        failed,
        skipped,
        durationMs,
        results,
    }
}

/**
 * Pretty-prints clean terminal summary table
 */
function printSummaryTable(summary: BatchSummary): void {
    console.log(chalk.bold('\n' + '='.repeat(80)))
    console.log(chalk.bold.cyan('📊 BATCH GENERATION SUMMARY'))
    console.log('='.repeat(80))

    const colWidths = {
        status: 8,
        file: 35,
        score: 12,
        attempts: 10,
    }

    const header =
        'STATUS'.padEnd(colWidths.status) +
        'FILE'.padEnd(colWidths.file) +
        'SCORE'.padEnd(colWidths.score) +
        'ATTEMPTS'.padEnd(colWidths.attempts)

    console.log(chalk.bold(header))
    console.log('-'.repeat(80))

    for (const r of summary.results) {
        const status = r.accepted
            ? chalk.green('PASSED'.padEnd(colWidths.status))
            : chalk.red('FAILED'.padEnd(colWidths.status))

        const name = path.basename(r.file)
        const truncatedName =
            name.length > colWidths.file - 3
                ? name.slice(0, colWidths.file - 4) + '...'
                : name
        const fileStr = truncatedName.padEnd(colWidths.file)

        const scoreStr = `${r.score}/${r.maxScore}`.padEnd(colWidths.score)
        const attemptsStr = `${r.attempts}`.padEnd(colWidths.attempts)

        console.log(`${status}${fileStr}${scoreStr}${attemptsStr}`)
    }

    console.log('='.repeat(80))
    const durationSec = (summary.durationMs / 1000).toFixed(1)
    console.log(
        `Total: ${summary.total} | Passed: ${chalk.green(summary.passed)} | Failed: ${chalk.red(summary.failed)} | Time: ${durationSec}s\n`
    )
}
