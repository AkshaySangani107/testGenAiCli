import axios from 'axios'
import * as fs from 'fs'
import { Project } from 'ts-morph'
import { CheckResult } from '../types'

function buildCompactClass(sourceFilePath: string): string {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.addSourceFileAtPath(sourceFilePath)
    const cls = sourceFile.getClasses()[0]
    if (!cls) throw new Error('No class found')

    const methods = cls.getMethods().map(m => `${m.getName()}(): ${m.getReturnType().getText()}`)
    const dependencies = cls.getConstructors()[0]?.getParameters().map(p => p.getType().getText()) || []

    return `class ${cls.getName()} {
  methods: ${methods.join(', ')}
  dependencies: ${dependencies.join(', ')}
}`
}

export async function runQualityCheck(
    sourceFilePath: string,
    specFilePath: string,
    apiUrl: string
): Promise<CheckResult> {

    // 1. Read files
    const specContent = fs.readFileSync(specFilePath, 'utf8')
    const compactClass = buildCompactClass(sourceFilePath)

    // 2. Call backend
    const response = await axios.post(
        `${apiUrl}/generate/evaluate/quality`,
        { specContent, compactClass },
        { timeout: 60000 }
    )

    // 3. Return CheckResult
    const { score, issues } = response.data

    return {
        name: 'llm-quality',
        passed: score >= 36,  // 80% of 45
        score: Math.min(score, 45),
        maxScore: 45,
        issues
    }
}
