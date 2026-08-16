export interface EvaluationIssue {
    category: string
    severity: 'low' | 'medium' | 'high'
    message: string
}

export interface CheckResult {
    name: string
    passed: boolean
    score: number
    maxScore: number
    issues: EvaluationIssue[]
}

export interface EvaluationResult {
    score: number
    maxScore: number
    passed: boolean
    checks: CheckResult[]
    issues: EvaluationIssue[]
}