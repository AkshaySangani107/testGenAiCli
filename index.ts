#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'

const program = new Command()

program
    .name('testgenai')
    .description('AI-powered test generator for TypeScript')
    .version('1.0.0')

program
    .argument('<file>', 'TypeScript file to generate tests for')
    .action(async (file: string) => {
        // Step 1: Resolve path
        const filePath = path.resolve(process.cwd(), file)

        if (!fs.existsSync(filePath)) {
            console.log(chalk.red(`❌ File not found: ${filePath}`))
            process.exit(1)
        }

        // Step 2: Read file
        const fileContent = fs.readFileSync(filePath, 'utf8')

        // Step 3: Spinner
        const spinner = ora('Generating tests...').start()

        try {
            const generatedCode = await apiCall(fileContent)

            spinner.succeed(chalk.green('Tests generated successfully!'))

            // Step 4: Write .spec.ts beside original file
            const parsed = path.parse(filePath)
            const specPath = path.join(
                parsed.dir,
                `${parsed.name}.spec${parsed.ext}`
            )

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

async function apiCall(fileContent: string): Promise<string> {
    const response = await axios.post(
        `${process.env.BACKEND_URL}/generate`,
        {
            fileContent,
        },
        {
            timeout: 120000,
        }
    )

    return response.data
}