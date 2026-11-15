import axios from 'axios'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import * as path from 'path'

export interface DatasetStatsResponse {
    total: number
    train: number
    val: number
    test: number
    averageScore: number
    firstPassCount: number
    curatedCount: number
}

export interface ExportCliOptions {
    url: string
    output: string
    format: 'chatml' | 'alpaca'
    minScore: number
    split?: 'all' | 'train' | 'val' | 'test'
    firstPassOnly?: boolean
}

export async function showDatasetStats(apiUrl: string): Promise<void> {
    const spinner = ora('Fetching dataset statistics...').start()
    try {
        const response = await axios.get<DatasetStatsResponse>(`${apiUrl}/dataset/stats`)
        spinner.stop()

        const stats = response.data
        console.log(chalk.bold.blue('\n📊 TestGenAI Fine-Tuning Dataset Statistics'))
        console.log(chalk.gray('──────────────────────────────────────────────────'))
        console.log(`  ${chalk.cyan('Total Verified Pairs:')}   ${chalk.bold.green(stats.total)}`)
        console.log(`  ${chalk.cyan('Train Split (80%):')}     ${chalk.yellow(stats.train)}`)
        console.log(`  ${chalk.cyan('Val Split (10%):')}       ${chalk.yellow(stats.val)}`)
        console.log(`  ${chalk.cyan('Test Split (10%):')}      ${chalk.yellow(stats.test)}`)
        console.log(chalk.gray('──────────────────────────────────────────────────'))
        console.log(`  ${chalk.cyan('Average Score:')}         ${chalk.magenta(`${stats.averageScore} / 80`)}`)
        const passRate = stats.total > 0 ? Math.round((stats.firstPassCount / stats.total) * 100) : 0
        console.log(`  ${chalk.cyan('Attempt 1 Pass Rate:')}   ${chalk.green(`${stats.firstPassCount} (${passRate}%)`)}`)
        console.log(`  ${chalk.cyan('Curated Gold Pairs:')}    ${chalk.blue(stats.curatedCount)}`)
        console.log(chalk.gray('──────────────────────────────────────────────────\n'))
    } catch (error: unknown) {
        spinner.fail(chalk.red('Failed to fetch dataset stats'))
        const msg = error instanceof Error ? error.message : String(error)
        console.log(chalk.red(`Error: ${msg}`))
    }
}

export async function exportDatasetFiles(options: ExportCliOptions): Promise<void> {
    const outputDir = path.resolve(process.cwd(), options.output)
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    }

    const splits: ('train' | 'val' | 'test')[] = options.split && options.split !== 'all' 
        ? [options.split] 
        : ['train', 'val', 'test']

    for (const split of splits) {
        const spinner = ora(`Exporting ${split} split (${options.format})...`).start()
        try {
            const url = `${options.url}/dataset/export`
            const response = await axios.get<string>(url, {
                params: {
                    format: options.format,
                    split,
                    minScore: options.minScore,
                    firstPassOnly: options.firstPassOnly,
                },
                responseType: 'text',
            })

            const content = response.data
            const lineCount = content ? content.trim().split('\n').filter(Boolean).length : 0
            const filename = `${split}.${options.format}.jsonl`
            const filePath = path.join(outputDir, filename)

            fs.writeFileSync(filePath, content || '', 'utf8')
            spinner.succeed(chalk.green(`Exported ${chalk.bold(split)} (${lineCount} pairs) -> ${filePath}`))
        } catch (error: unknown) {
            spinner.fail(chalk.red(`Failed to export ${split} split`))
            const msg = error instanceof Error ? error.message : String(error)
            console.log(chalk.red(`Error: ${msg}`))
        }
    }
}
