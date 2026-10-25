export interface MethodGapInfo {
    name: string
    isAsync: boolean
    tested: boolean
    callCount: number
}

export interface BranchGapInfo {
    method: string
    condition: string
    type: 'guard_throw' | 'if_branch' | 'catch_block'
    throwType?: string
    tested: boolean
}

export interface CoverageGapReport {
    totalMethods: number
    testedMethodsCount: number
    uncoveredMethods: string[]
    methodCoveragePct: number
    totalBranches: number
    branches: BranchGapInfo[]
    uncoveredBranches: BranchGapInfo[]
    branchCoveragePct: number
    overallCoveragePct: number
    meetsThreshold: boolean
}
