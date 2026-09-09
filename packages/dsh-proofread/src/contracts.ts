export const PROOFREAD_RPC_CHANNEL = '/proofread'
export const PROOFREAD_MAX_TEXT_BYTES = 2_000_000
export const PROOFREAD_MAX_FINDINGS = 500
export const TEXT_PROOFREAD_KINDS = ['punctuation', 'sensitive', 'repeat', 'typo', 'habit'] as const
export type TextProofreadKind = typeof TEXT_PROOFREAD_KINDS[number]
export const PROOFREAD_KINDS = [...TEXT_PROOFREAD_KINDS, 'card'] as const
export type ProofreadKind = typeof PROOFREAD_KINDS[number]
export type ProofreadSeverity = 'error' | 'warning' | 'info'
export type ProofreadFinding = {
  path: string
  line: number
  column: number
  start: number
  end: number
  kind: ProofreadKind
  severity: ProofreadSeverity
  message: string
  excerpt: string
  suggestion?: string
  code?: string
  term?: string
  version: string
}
export type ProofreadHabitStat = { term: string; count: number; perThousand: number }
export type TextCheckRequest = { text: string; kinds?: TextProofreadKind[] }
export type TextCheckResult = { findings: ProofreadFinding[]; habitStats: ProofreadHabitStat[]; truncated: boolean }
export type ProofreadRpcResult =
  | { ok: true; value: TextCheckResult }
  | { ok: false; error: { code: 'bad-request' | 'cancelled' | 'internal'; message: string; details: Record<string, unknown> } }
