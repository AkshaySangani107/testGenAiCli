#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import * as inquirer from 'inquirer'

dotenv.config()

const program = new Command()

program
    .name('testgenai')
    .description('AI-powered test generator for TypeScript')
    .version('1.0.0')

program
    .argument('<file>', 'TypeScript file to generate tests for')
    .option('-o, --output <dir>', 'Output directory for the generated tests')
    .option('-d, --dry-run', 'Skip writing to file and print output')
    .action(async (file: string, options: { output?: string, dryRun?: boolean }) => {
        // Step 1: Resolve path
        const filePath = path.resolve(process.cwd(), file)

        if (!fs.existsSync(filePath)) {
            console.log(chalk.red(`❌ File not found: ${filePath}`))
            process.exit(1)
        }

        if (!filePath.endsWith('.ts')) {
            console.log(chalk.red('❌ Only .ts files are supported.'))
            process.exit(1)
        }

        // Step 2: Read file
        const fileContent = fs.readFileSync(filePath, 'utf8')

        const apiUrl = process.env.TESTGENAI_API_URL || 'http://localhost:3000'

        // Step 3: Health check
        try {
            await axios.get(`${apiUrl}/health`, { timeout: 5000 })
        } catch (error) {
            console.log(chalk.red(`❌ Backend is offline (${apiUrl})`))
            process.exit(1)
        }

        // Step 4: Spinner
        const spinner = ora('Generating tests...').start()

        try {
            const generatedCode = await apiCall(fileContent, apiUrl)

            spinner.succeed(chalk.green('Tests generated successfully!'))

            if (options.dryRun) {
                console.log(chalk.yellow('\n--- Dry Run Output ---\n'))
                console.log(generatedCode)
                console.log(chalk.yellow('\n----------------------\n'))
                return;
            }

            // Step 5: Write .spec.ts
            const parsed = path.parse(filePath)
            
            let targetDir = parsed.dir
            if (options.output) {
                targetDir = path.resolve(process.cwd(), options.output)
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true })
                }
            }

            const specPath = path.join(targetDir, `${parsed.name}.spec${parsed.ext}`)

            if (fs.existsSync(specPath)) {
                const answers = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'overwrite',
                    message: `File ${specPath} already exists. Overwrite?`,
                    default: false
                }])
                if (!answers.overwrite) {
                    console.log(chalk.yellow('Skipped generation.'))
                    process.exit(0)
                }
            }

            fs.writeFileSync(specPath, generatedCode, 'utf8')

            console.log(chalk.blue(`📄 Written to: ${specPath}`))
        } catch (error) {
            spinner.fail(chalk.red('Generation failed'))

            if (axios.isAxiosError(error)) {
                console.log(chalk.red(error.response?.data?.message ?? error.message))
            } else if (error instanceof Error) {
                console.log(chalk.red(error.message))
            } else {
                console.log(chalk.red('Unknown error'))
            }

            process.exit(1)
        }
    })

program.parse()

async function apiCall(fileContent: string, apiUrl: string): Promise<string> {
    const response = await axios.post(
        `${apiUrl}/generate`,
        { fileContent },
        { timeout: 120000 }
    )
    return response.data
}