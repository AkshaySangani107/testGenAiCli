#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import * as path from 'path'
import * as inquirer from 'inquirer'
import axios from 'axios'
import { runGenerationLoop } from './src/generation/generation.runner'
import { discoverTargetFiles } from './src/batch/file.finder'
import { runBatch, findProjectRoot } from './src/batch/batch.runner'

interface GlobalOptions {
    output?: string
    dryRun?: boolean
    url: string
    yes?: boolean
    batch?: boolean
    onlyMissing?: boolean
    concurrency?: string
    minCoverage?: string
    expand?: boolean
}

const program = new Command()

program
    .name('testgenai')
    .description('AI-powered test generator for TypeScript')
    .version('1.0.0')

program
    .argument('<target>', 'File, directory, or glob pattern to generate tests for (e.g. src/user.service.ts, src/, or "**/*.service.ts")')
    .option('-b, --batch', 'Run in batch mode for directories or wildcard patterns')
    .option('-m, --only-missing', 'In batch mode, only generate tests for services that do not have a .spec.ts file')
    .option('-c, --concurrency <number>', 'Number of files to process concurrently in batch mode', '1')
    .option('-C, --min-coverage <number>', 'Target minimum code coverage percentage (default: 75)')
    .option('-e, --expand', 'Perform smart test expansion to cover missing methods and error branches')
    .option('-o, --output <dir>', 'Output directory for generated tests')
    .option('-d, --dry-run', 'Print generated tests without writing files')
    .option('-u, --url <url>', 'Backend URL', 'http://localhost:3000')
    .option('-y, --yes', 'Automatically overwrite existing test files without prompting')
    .action(async (target: string, options: GlobalOptions) => {
        // ── Step 1: Health check ──
        try {
            await axios.get(`${options.url}/health`, { timeout: 5000 })
        } catch {
            console.log(chalk.red(`❌ Backend is offline (${options.url})`))
            console.log(chalk.gray('Start backend with: npm run start:dev'))
            process.exit(1)
        }

        const resolvedTarget = path.resolve(process.cwd(), target)
        const isDirectory = fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()
        const isGlobPattern = target.includes('*') || target.includes('{')
        const shouldRunBatch = options.batch || isDirectory || isGlobPattern

        // ═════════════════════════════════════════════════════
        // BATCH MODE
        // ═════════════════════════════════════════════════════
        if (shouldRunBatch) {
            const rootDir = isDirectory ? resolvedTarget : process.cwd()
            const searchPattern = isDirectory ? undefined : target

            const files = discoverTargetFiles({
                rootDir,
                pattern: searchPattern,
                onlyMissing: options.onlyMissing,
            })

            if (files.length === 0) {
                console.log(chalk.yellow(`\n⚠️  No eligible TypeScript service files found matching: ${target}`))
                if (options.onlyMissing) {
                    console.log(chalk.gray('All matched files already have corresponding .spec.ts test files.'))
                }
                process.exit(0)
            }

            const projectRoot = findProjectRoot(files[0]) || process.cwd()
            const concurrencyNumber = Math.max(1, parseInt(options.concurrency || '1', 10) || 1)

            console.log(chalk.blue(`\n📂 Discovered ${files.length} file(s) for batch generation:`))
            files.forEach((f) => console.log(chalk.gray(`  • ${path.relative(process.cwd(), f)}`)))

            const minCoverageNumber = options.minCoverage
                ? parseInt(options.minCoverage, 10) || 75
                : 75

            await runBatch({
                files,
                projectRoot,
                apiUrl: options.url,
                outputDir: options.output,
                dryRun: options.dryRun,
                yes: options.yes,
                concurrency: concurrencyNumber,
                minCoverage: minCoverageNumber,
            })
            return
        }

        // ═════════════════════════════════════════════════════
        // SINGLE FILE MODE
        // ═════════════════════════════════════════════════════
        const filePath = resolvedTarget

        if (!fs.existsSync(filePath)) {
            console.log(chalk.red(`❌ File not found: ${filePath}`))
            process.exit(1)
        }

        if (!filePath.endsWith('.ts')) {
            console.log(chalk.red('❌ Only .ts files are supported'))
            process.exit(1)
        }

        const projectRoot = findProjectRoot(filePath)
        if (!projectRoot) {
            console.log(chalk.red('❌ Could not find project root (tsconfig.json)'))
            process.exit(1)
        }

        console.log(chalk.blue(`\n🔍 Analyzing: ${path.basename(filePath)}`))
        console.log(chalk.gray(`📁 Project root: ${projectRoot}\n`))

        const spinner = ora('Generating tests (attempt 1)...').start()
        const minCoverageTarget = options.minCoverage
            ? parseInt(options.minCoverage, 10) || 75
            : 75

        try {
            const result = await runGenerationLoop({
                sourceFilePath: filePath,
                projectRoot,
                apiUrl: options.url,
                minCoverage: minCoverageTarget,
                expandOnly: options.expand,
                onAttempt: (attempt, score, statusMsg) => {
                    if (statusMsg) {
                        spinner.text = chalk.cyan(statusMsg)
                    } else if (attempt > 1) {
                        spinner.text = `Improving tests (attempt ${attempt}, score: ${score}/80)...`
                    }
                },
            })

            spinner.stop()

            if (result.accepted) {
                console.log(chalk.green(`✅ Tests accepted on attempt ${result.attempts}`))
            } else {
                console.log(chalk.yellow(`⚠️  Max attempts reached — using best result`))
            }

            console.log(chalk.gray(`📊 Score: ${result.score}/${result.maxScore}`))
            if (result.coverageReport) {
                const cov = result.coverageReport
                const statusColor = cov.meetsThreshold ? chalk.green : chalk.yellow
                console.log(
                    statusColor(`🎯 Coverage: ${cov.overallCoveragePct}% (Methods: ${cov.methodCoveragePct}%, Branches: ${cov.branchCoveragePct}%)`)
                )
                if (cov.uncoveredMethods.length > 0) {
                    console.log(chalk.yellow(`⚠️  Untested methods: ${cov.uncoveredMethods.join(', ')}`))
                }
            }
            console.log(chalk.gray(`🔄 Attempts: ${result.attempts}`))

            if (options.dryRun) {
                console.log(chalk.yellow('\n--- Dry Run Output ---\n'))
                console.log(result.specContent)
                console.log(chalk.yellow('\n----------------------\n'))
                return
            }

            const parsed = path.parse(filePath)
            let targetDir = parsed.dir

            if (options.output) {
                targetDir = path.resolve(process.cwd(), options.output)
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true })
                }
            }

            const specPath = path.join(targetDir, `${parsed.name}.spec${parsed.ext}`)

            if (fs.existsSync(specPath) && !options.yes) {
                const answers = await inquirer.prompt<{ overwrite: boolean }>([
                    {
                        type: 'confirm',
                        name: 'overwrite',
                        message: `${specPath} already exists. Overwrite?`,
                        default: false,
                    },
                ])
                if (!answers.overwrite) {
                    console.log(chalk.yellow('Skipped.'))
                    process.exit(0)
                }
            }

            fs.writeFileSync(specPath, result.specContent, 'utf8')
            console.log(chalk.blue(`\n📄 Written to: ${specPath}`))

            if (!result.accepted) {
                console.log(
                    chalk.yellow('\n⚠️  Score below threshold. Tests may need manual fixes for:')
                )
                console.log(chalk.gray('   - Custom DTO property names'))
                console.log(chalk.gray('   - Internal import paths'))
                console.log(chalk.gray('   - Custom repository method names'))
            }
        } catch (error: unknown) {
            spinner.fail(chalk.red('Generation failed'))
            const errMsg = error instanceof Error ? error.message : String(error)
            console.log(chalk.red(errMsg))
            process.exit(1)
        }
    })

program.parse()