// cli/src/evaluation/deterministic/compilation.evaluator.ts

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { CheckResult, EvaluationIssue } from '../types'

// ── Function 1: Validate tsconfig exists ──
function findTsConfig(projectRoot: string): string | null {
    const tsConfigPath = path.join(projectRoot, 'tsconfig.json')

    if (fs.existsSync(tsConfigPath)) {
        return tsConfigPath
    }

    return null
}

// ── Function 2: Create temp tsconfig ──
function createTempTsConfig(
    tsConfigPath: string,
    specFilePath: string
): string {

    const tempTsConfigPath = path.join(
        os.tmpdir(),
        `tsconfig-${Date.now()}.json`
    )

    const extendsPath = path.relative(
        os.tmpdir(),
        tsConfigPath
    )

    const tsConfig = {
        extends: extendsPath,
        include: [specFilePath],
        exclude: [],
        compilerOptions: {
            noEmit: true,
            allowJs: true,
        }
    }

    fs.writeFileSync(
        tempTsConfigPath,
        JSON.stringify(tsConfig, null, 2)
    )

    return tempTsConfigPath
}

// ── Function 3: Run tsc and get raw output ──
function runTsc(
    tempTsConfigPath: string,
    projectRoot: string
): { output: string; passed: boolean } {

    try {

        const result = execSync(
            `npx tsc --project "${tempTsConfigPath}" --noEmit`,
            {
                cwd: projectRoot,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        )

        return {
            output: result?.toString() ?? '',
            passed: true
        }

    } catch (error: any) {

        const stdout =
            error.stdout?.toString() ?? ''

        const stderr =
            error.stderr?.toString() ?? ''

        return {
            output: stdout + stderr,
            passed: false
        }
    }
}

// ── Function 4: Parse tsc errors into issues ──
function parseTscErrors(
    output: string,
    specFilePath: string
): EvaluationIssue[] {

    const issues: EvaluationIssue[] = []

    output
        .split('\n')
        .filter(line => line.includes('.spec.ts'))
        .forEach(line => {

            // Matches:
            // src/broken.spec.ts(1,31): error TS2307: message
            const match = line.match(
                /\((\d+),(\d+)\): error (TS\d+): (.*)/
            )

            if (match) {

                issues.push({
                    category: 'compilation',
                    severity: 'high',
                    message:
                        `[${match[3]}] Line ${match[1]}: ${match[4].trim()}`
                })
            }
        })

    return issues
}

// ── Function 5: Cleanup temp file ──
function cleanupTempFile(tempPath: string): void {

    try {

        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath)
        }

    } catch {
        // Silently ignore cleanup errors
    }
}

// ── Main evaluator function ──
export async function runCompilationCheck(
    specFilePath: string,
    projectRoot: string
): Promise<CheckResult> {

    // 1. Find tsconfig
    const tsConfigPath = findTsConfig(projectRoot)

    if (!tsConfigPath) {

        return {
            name: 'typescript-compilation',
            passed: false,
            score: 0,
            maxScore: 10,
            issues: [{
                category: 'configuration',
                severity: 'high',
                message:
                    'No tsconfig.json found in project root'
            }]
        }
    }

    // 2. Create temp tsconfig
    const tempTsConfigPath =
        createTempTsConfig(
            tsConfigPath,
            specFilePath
        )

    try {

        // 3. Run tsc
        const {
            output,
            passed
        } = runTsc(
            tempTsConfigPath,
            projectRoot
        )

        // 4. Parse errors
        const issues = passed
            ? []
            : parseTscErrors(
                output,
                specFilePath
            )

        // 5. Return result
        const finalPassed =
            passed && issues.length === 0

        return {
            name: 'typescript-compilation',
            passed: finalPassed,
            score: finalPassed ? 10 : 0,
            maxScore: 10,
            issues
        }

    } finally {

        // Always cleanup temp file
        cleanupTempFile(
            tempTsConfigPath
        )
    }
}
