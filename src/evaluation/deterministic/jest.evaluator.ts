import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { CheckResult, EvaluationIssue } from '../types'

function stripAnsi(text: string): string {
    return text.replace(/\u001B(?:[@-_][0-?]*[ -/]*[@-~])/g, '')
}

function findJestConfig(projectRoot: string): string | null {
    const configFiles = [
        'jest.config.ts',
        'jest.config.js',
        'jest.config.mjs',
        'jest.config.cjs'
    ]

    for (const file of configFiles) {
        const filePath = path.join(projectRoot, file)
        if (fs.existsSync(filePath)) return filePath
    }

    const packageJsonPath = path.join(projectRoot, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
            if (packageJson.jest) return packageJsonPath
        } catch {
            // ignore parse errors
        }
    }

    return null
}

function runJest(
    specFilePath: string,
    projectRoot: string
): { output: string; passed: boolean; exitCode: number } {
    const command = `npx jest "${specFilePath}" --runInBand --forceExit`

    try {
        const output = execSync(command, {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8'
        })
        return { output: output ?? '', passed: true, exitCode: 0 }
    } catch (error: any) {
        const stdout = error.stdout?.toString() ?? ''
        const stderr = error.stderr?.toString() ?? ''
        return {
            output: `${stdout}\n${stderr}`.trim(),
            passed: false,
            exitCode: error.status ?? 1
        }
    }
}

function calculatePartialScore(output: string): number {
    const match = stripAnsi(output).match(
        /Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/
    )
    if (!match) return 0
    const passed = parseInt(match[2])
    const total = parseInt(match[3])
    return Math.round((passed / total) * 10)
}

function parseJestErrors(
    output: string,
    specFilePath: string
): EvaluationIssue[] {
    const issues: EvaluationIssue[] = []
    const cleanOutput = stripAnsi(output)
    const lines = cleanOutput.split(/\r?\n/)
    let currentTest: string | null = null

    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        if (line === '● Test suite failed to run') continue

        if (line.startsWith('●')) {
            currentTest = line.replace(/^●\s*/, '').trim()
            continue
        }

        const tsErrorMatch = line.match(
            /^(.+):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s*(.*)$/
        )
        if (tsErrorMatch) {
            const [, file, lineNumber, column, code, message] = tsErrorMatch
            issues.push({
                category: 'compilation',
                severity: 'high',
                message: `[${code}] ${message} (${file}:${lineNumber}:${column})`
            })
            continue
        }

        if (line.startsWith('Expected:')) {
            issues.push({
                category: 'test-assertion',
                severity: 'high',
                message: currentTest ? `${currentTest} → ${line}` : line
            })
            continue
        }

        if (line.startsWith('Received:')) {
            issues.push({
                category: 'test-assertion',
                severity: 'high',
                message: currentTest ? `${currentTest} → ${line}` : line
            })
            continue
        }

        if (line.startsWith('expect(') || line.includes('expect(received)')) {
            issues.push({
                category: 'test-assertion',
                severity: 'high',
                message: currentTest ? `${currentTest} → ${line}` : line
            })
            continue
        }

        if (
            line.startsWith('TypeError:') ||
            line.startsWith('ReferenceError:') ||
            line.startsWith('SyntaxError:') ||
            line.startsWith('Error:')
        ) {
            issues.push({
                category: 'test-runtime',
                severity: 'high',
                message: currentTest ? `${currentTest} → ${line}` : line
            })
            continue
        }
    }

    if (issues.length === 0) {
        issues.push({
            category: 'test-runtime',
            severity: 'high',
            message: `Jest failed while executing ${path.basename(specFilePath)}. Check raw Jest output for details.`
        })
    }

    return issues
}

export async function runJestCheck(
    specFilePath: string,
    projectRoot: string
): Promise<CheckResult> {
    const jestConfigPath = findJestConfig(projectRoot)

    if (!jestConfigPath) {
        return {
            name: 'jest-execution',
            passed: false,
            score: 0,
            maxScore: 10,
            issues: [{
                category: 'configuration',
                severity: 'high',
                message: 'No Jest configuration found in project root'
            }]
        }
    }

    const jestResult = runJest(specFilePath, projectRoot)

    const issues = jestResult.passed
        ? []
        : parseJestErrors(jestResult.output, specFilePath)

    const score = jestResult.passed
        ? 10
        : calculatePartialScore(jestResult.output)

    return {
        name: 'jest-execution',
        passed: jestResult.passed,
        score,
        maxScore: 10,
        issues
    }
}
