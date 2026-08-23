import * as fs from 'fs';
import { Project } from 'ts-morph';
import { CheckResult, EvaluationIssue } from '../types';

interface MethodCoverage {
    name: string
    tested: boolean
}

// ── Function 1: Parse source file methods ──
function parseSourceMethods(sourceFilePath: string): string[] {
    // Use ts-morph to extract method names from source file
    // Return array of method names
    // Hint: you already did this in the backend parser!
    const project = new Project()
    const sourceFile = project.addSourceFileAtPath(sourceFilePath)

    const methods: string[] = []

    sourceFile.getClasses().forEach(cls => {
        cls.getMethods().forEach(method => {
            methods.push(method.getName())
        })
    })

    return methods
}

// ── Function 2: Check which methods appear in spec ──
function checkMethodCoverage(
    methods: string[],
    specContent: string
): MethodCoverage[] {
    // For each method check if name appears in specContent
    // Return array of { name, tested }
    return methods.map(method => {
        const tested = specContent.includes(method)
        return { name: method, tested }
    })
}

// ── Function 3: Calculate score ──
function calculateCoverageScore(
    coverage: MethodCoverage[],
    maxScore: number
): number {
    // tested / total * maxScore
    // Round to nearest integer
    if (coverage.length === 0) return maxScore
    const testedCount = coverage.filter(c => c.tested).length
    const totalCount = coverage.length
    return Math.round((testedCount / totalCount) * maxScore)
}

// ── Main evaluator ──
export async function runCoverageCheck(
    sourceFilePath: string,
    specFilePath: string,
): Promise<CheckResult> {

    // 1. Parse source methods
    const methods = parseSourceMethods(sourceFilePath)
    // 2. Read spec content
    const specContent = fs.readFileSync(specFilePath, 'utf8')
    // 3. Check coverage
    const coverage = checkMethodCoverage(methods, specContent)
    // 4. Calculate score
    const score = calculateCoverageScore(coverage, 10)
    // 5. Build issues for untested methods
    const issues: EvaluationIssue[] = []
    coverage.forEach(c => {
        if (!c.tested) {
            issues.push({
                category: 'test-coverage',
                severity: 'high',
                message: `Method ${c.name} is not tested`
            })
        }
    })
    // 6. Return CheckResult (maxScore: 10)
    return {
        name: 'test-coverage',
        passed: issues.length === 0,
        score,
        maxScore: 10,
        issues
    }
}
