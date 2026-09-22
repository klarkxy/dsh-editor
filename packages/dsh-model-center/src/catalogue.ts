import type { PurposeSpec } from './contracts.ts'

/** DSH GenerateOptions.purpose values. Shown only as labels for live registrations. */
export const BUILTIN_PURPOSE_CATALOGUE: readonly Pick<PurposeSpec, 'id' | 'label' | 'defaultTarget'>[] = [
  { id: 'compaction', label: '会话压缩', defaultTarget: { kind: 'role', role: 'weak' } },
  { id: 'session-title', label: '会话标题', defaultTarget: { kind: 'role', role: 'weak' } },
]

export const DSH_GENERATE_PURPOSES = ['compaction', 'session-title'] as const

export function purposeLabel(id: string, registeredLabel?: string, locale: 'zh' | 'en' = 'zh'): string {
  if (registeredLabel) return registeredLabel
  const known = BUILTIN_PURPOSE_CATALOGUE.find(item => item.id === id)
  if (known) {
    if (locale === 'en') return id === 'compaction' ? 'Compaction' : 'Session title'
    return known.label
  }
  return id
}

export function catalogueLabel(id: string): string | undefined {
  return BUILTIN_PURPOSE_CATALOGUE.find(item => item.id === id)?.label
}
