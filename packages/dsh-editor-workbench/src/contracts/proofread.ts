import { PROOFREAD_KINDS, type ProofreadKind, type ProofreadSeverity, type ProofreadFinding, type ProofreadHabitStat } from 'dsh-proofread/contracts'
export { PROOFREAD_KINDS, type ProofreadKind, type ProofreadSeverity, type ProofreadFinding, type ProofreadHabitStat }

export type ProofreadScanRequest = {
  sessionId: string
  scope: 'document' | 'manuscript'
  path?: string
  kinds?: ProofreadKind[]
}
export type ProofreadScanResponse = {
  findings: ProofreadFinding[]
  scannedFiles: number
  skipped: number
  truncated: boolean
  habitStats: ProofreadHabitStat[]
}
