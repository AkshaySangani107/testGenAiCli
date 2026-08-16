import * as fs from 'fs'
import { CheckResult, EvaluationIssue } from '../types'

// ── Check 1: detect .only usage ──
function checkOnlyUsage(content: string): EvaluationIssue[] {

    // Check for describe.only, it.only, test.only
    // Return issue for each found
    const issues: EvaluationIssue[] = []

    const onlyRegex = /(describe|it|test)\.only\s*\(/g
    let match

    while ((match = onlyRegex.exec(content)) !== null) {
        issues.push({
            category: 'test-integrity',
            severity: 'medium',
            message: `Found .only usage: ${match[0].trim()}`
        })
    }

    return issues
}

// ── Check 2: detect .skip usage ──
function checkSkipUsage(content: string): EvaluationIssue[] {

    // Check for describe.skip, it.skip, test.skip
    const issues: EvaluationIssue[] = []

    const skipRegex = /(describe|it|test)\.skip\s*\(/g
    let match

    while ((match = skipRegex.exec(content)) !== null) {
        issues.push({
            category: 'test-integrity',
            severity: 'medium',
            message: `Found .skip usage: ${match[0].trim()}`
        })
    }

    return issues
}

// ── Check 3: detect empty test blocks ──
function checkEmptyTests(content: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = []

    const hasTests = /\b(it|test)\s*\(/.test(content)
    const hasExpects = /\bexpect\s*\(/.test(content)

    if (hasTests && !hasExpects) {
        issues.push({
            category: 'test-integrity',
            severity: 'high',
            message: 'Test file contains no expect() assertions'
        })
    }

    return issues
}

// ── Check 4: detect fake assertions ──
function checkFakeAssertions(content: string): EvaluationIssue[] {

    // Check for expect(true).toBe(true)
    // Check for expect(x).toBeDefined() as only assertion
    const issues: EvaluationIssue[] = []

    const fakePatterns = [
        /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/,
        /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/,
        /expect\(\s*1\s*\)\.toBe\(\s*1\s*\)/,
        /expect\(\s*["'].*["']\s*\)\.toBe\(\s*["'].*["']\s*\)/,
    ]

    fakePatterns.forEach(pattern => {
        if (pattern.test(content)) {
            const matched = content.match(pattern)?.[0] ?? ''
            issues.push({
                category: 'test-integrity',
                severity: 'high',
                message: `Fake assertion detected: ${matched.trim()}`
            })
        }
    })

    return issues
}

// ── Check 5: file has tests but only toBeDefined assertions ──
function checkWeakAssertions(content: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = []

    const expectCount = (content.match(/\bexpect\s*\(/g) || []).length
    const toBeDefinedCount = (content.match(/\.toBeDefined\(\)/g) || []).length

    // If ALL assertions are just toBeDefined = weak tests
    if (expectCount > 0 && expectCount === toBeDefinedCount) {
        issues.push({
            category: 'test-integrity',
            severity: 'medium',
            message: 'All assertions only check toBeDefined() — consider stronger assertions'
        })
    }

    return issues
}

// ── Main evaluator ──
export async function runIntegrityCheck(
    specFilePath: string
): Promise<CheckResult> {
    const content = fs.readFileSync(specFilePath, 'utf8')
    const issues: EvaluationIssue[] = []

    issues.push(...checkOnlyUsage(content))
    issues.push(...checkSkipUsage(content))
    issues.push(...checkEmptyTests(content))
    issues.push(...checkFakeAssertions(content))
    issues.push(...checkWeakAssertions(content))

    // Score: start at 5, deduct per issue

    let score = 5
    issues.forEach(issue => {
        if (issue.severity === 'high') score -= 2
        if (issue.severity === 'medium') score -= 1
    })

    return {
        name: 'test-integrity',
        passed: issues.length === 0,
        score: score < 0 ? 0 : score,
        maxScore: 5,
        issues
    }
}


