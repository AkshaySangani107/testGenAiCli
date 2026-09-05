#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import * as path from 'path'
import * as inquirer from 'inquirer'
import { runGenerationLoop } from './src/generation/generation.runner'

const program = new Command()

program
    .name('testgenai')
    .description('AI-powered test generator for TypeScript')
    .version('1.0.0')

program
    .argument('<file>', 'TypeScript file to generate tests for')
    .option('-o, --output <dir>', 'Output directory for generated tests')
    .option('-d, --dry-run', 'Print generated tests without writing file')
    .option('-u, --url <url>', 'Backend URL', 'http://localhost:3000')
    .action(async (
        file: string,
        options: { output?: string; dryRun?: boolean; url: string }
    ) => {

        // ── Step 1: Validate file ──
        const filePath = path.resolve(process.cwd(), file)

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

        // ── Step 2: Health check ──
        try {
            const axios = require('axios')
            await axios.get(`${options.url}/health`, { timeout: 5000 })
        } catch {
            console.log(chalk.red(`❌ Backend is offline (${options.url})`))
            console.log(chalk.gray('Start backend with: npm run start:dev'))
            process.exit(1)
        }

        // ── Step 3: Generation loop ──
        console.log(chalk.blue(`\n🔍 Analyzing: ${path.basename(filePath)}`))
        console.log(chalk.gray(`📁 Project root: ${projectRoot}\n`))

        const spinner = ora('Generating tests (attempt 1)...').start()

        try {
            const result = await runGenerationLoop({
                sourceFilePath: filePath,
                projectRoot,
                apiUrl: options.url,
                onAttempt: (attempt, score) => {
                    if (attempt > 1) {
                        spinner.text = `Improving tests (attempt ${attempt}, score: ${score}/80)...`
                    }
                }
            })

            spinner.stop()

            // ── Step 4: Show result ──
            if (result.accepted) {
                console.log(chalk.green(`✅ Tests accepted on attempt ${result.attempts}`))
            } else {
                console.log(chalk.yellow(`⚠️  Max attempts reached — using best result`))
            }

            console.log(chalk.gray(`📊 Score: ${result.score}/${result.maxScore}`))
            console.log(chalk.gray(`🔄 Attempts: ${result.attempts}`))

            // ── Step 5: Dry run ──
            if (options.dryRun) {
                console.log(chalk.yellow('\n--- Dry Run Output ---\n'))
                console.log(result.specContent)
                console.log(chalk.yellow('\n----------------------\n'))
                return
            }

            // ── Step 6: Determine output path ──
            const parsed = path.parse(filePath)
            let targetDir = parsed.dir

            if (options.output) {
                targetDir = path.resolve(process.cwd(), options.output)
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true })
                }
            }

            const specPath = path.join(targetDir, `${parsed.name}.spec${parsed.ext}`)

            // ── Step 7: Overwrite protection ──
            if (fs.existsSync(specPath)) {
                const answers = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'overwrite',
                    message: `${specPath} already exists. Overwrite?`,
                    default: false
                }])
                if (!answers.overwrite) {
                    console.log(chalk.yellow('Skipped.'))
                    process.exit(0)
                }
            }

            // ── Step 8: Write file ──
            fs.writeFileSync(specPath, result.specContent, 'utf8')
            console.log(chalk.blue(`\n📄 Written to: ${specPath}`))

            if (!result.accepted) {
                console.log(chalk.yellow(
                    '\n⚠️  Score below threshold. Tests may need manual fixes for:'
                ))
                console.log(chalk.gray('   - Custom DTO property names'))
                console.log(chalk.gray('   - Internal import paths'))
                console.log(chalk.gray('   - Custom repository method names'))
            }

        } catch (error: any) {
            spinner.fail(chalk.red('Generation failed'))
            console.log(chalk.red(error.message))
            process.exit(1)
        }
    })

program.parse()

// ── Find project root by walking up directories ──
function findProjectRoot(filePath: string): string | null {
    let dir = path.dirname(filePath)
    while (dir !== path.parse(dir).root) {
        if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
            return dir
        }
        dir = path.dirname(dir)
    }
    return null
}