import type { PluginCard } from './contracts.ts'

export type FeatureGroupDef = {
  id: string
  title: string
  description: string
  packages: readonly string[]
}

/** Author-purpose groups. Package names stay in details; do not merge packages. */
export const FEATURE_GROUP_DEFS: readonly FeatureGroupDef[] = [
  {
    id: 'writing',
    title: '写作辅助',
    description: '行内补全、选段改写，以及写作搭档可用的小说工具。',
    packages: ['dsh-manuscript', 'dsh-editor-novel-kernel'],
  },
  {
    id: 'proofread',
    title: '校对',
    description: '检查标点、错别字与常见用词问题。',
    packages: ['dsh-proofread', 'dsh-editor-proofread-panel'],
  },
  {
    id: 'overview',
    title: '作品概览',
    description: '章节状态、字数分布与写作进度。',
    packages: ['dsh-editor-workbench', 'dsh-editor-overview-panel'],
  },
  {
    id: 'cards',
    title: '人物与世界书',
    description: '人物卡、世界书与引用导航。',
    packages: ['dsh-editor-cards'],
  },
  {
    id: 'memory',
    title: '写作记忆',
    description: '查看和应用写作搭档提出的维护建议。',
    packages: ['dsh-editor-memory-panel'],
  },
  {
    id: 'zhihu',
    title: '知乎资料',
    description: '检索知乎资料，供写作时查阅。',
    packages: ['dsh-zhihu'],
  },
]

export type FeatureGroupView = {
  id: string
  title: string
  description: string
  cards: PluginCard[]
  composition: string[]
}

const INTERNAL_TERM = /\bfrontmatter\b|AGENTS\.md|CLAUDE\.md|GEMINI\.md/gi

export function authorFacingDescription(text: string): string {
  const cleaned = text
    .replace(INTERNAL_TERM, ' ')
    .replace(/\//g, ' ')
    .replace(/\s*、\s*/g, '、')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[、；;，,\s]+|[、；;，,\s]+$/g, '')
    .trim()
  return cleaned || text.trim()
}

export function enabledState(cards: PluginCard[]): boolean | 'mixed' {
  const enabled = cards.filter((card) => card.enabled).length
  if (enabled === 0) return false
  if (enabled === cards.length) return true
  return 'mixed'
}

export function toggleableCards(cards: PluginCard[]): PluginCard[] {
  return cards.filter((card) => !card.locked)
}

export function groupByPackage(cards: PluginCard[]): PluginCard[][] {
  const groups: PluginCard[][] = []
  const index = new Map<string, PluginCard[]>()
  for (const card of cards) {
    const existing = index.get(card.packageName)
    if (existing) {
      existing.push(card)
      continue
    }
    const next = [card]
    index.set(card.packageName, next)
    groups.push(next)
  }
  return groups
}

function compositionOf(cards: PluginCard[]): string[] {
  const rows: string[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    const label = `${card.title}（${card.packageName}）`
    if (seen.has(label)) continue
    seen.add(label)
    rows.push(label)
  }
  return rows
}

export function groupOptionalFeatures(cards: PluginCard[]): FeatureGroupView[] {
  const remaining = cards.filter((card) => !card.locked)
  const views: FeatureGroupView[] = []
  for (const def of FEATURE_GROUP_DEFS) {
    const matched: PluginCard[] = []
    for (const card of remaining) {
      if (def.packages.includes(card.packageName)) matched.push(card)
    }
    if (matched.length === 0) continue
    const matchedIds = new Set(matched.map((card) => card.entryId))
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (matchedIds.has(remaining[index]!.entryId)) remaining.splice(index, 1)
    }
    views.push({
      id: def.id,
      title: def.title,
      description: def.description,
      cards: matched,
      composition: compositionOf(matched),
    })
  }
  for (const group of groupByPackage(remaining)) {
    const primary = group[0]!
    views.push({
      id: primary.packageName,
      title: primary.title,
      description: authorFacingDescription(primary.description),
      cards: group,
      composition: compositionOf(group),
    })
  }
  return views
}

const FS_ERROR = /\b(EPERM|EACCES|EBUSY|EEXIST|ENOENT|EAGAIN)\b|rename ['"]/i

export function authorPluginError(message: string, fallback: string, details?: Record<string, unknown>): { message: string; detail?: string } {
  const cause = typeof details?.cause === 'string' ? details.cause : undefined
  const raw = message || fallback
  if (FS_ERROR.test(raw) || (cause !== undefined && FS_ERROR.test(cause))) {
    return { message: '未能保存插件开关，请重试。', detail: cause || raw }
  }
  return cause && cause !== raw ? { message: raw, detail: cause } : { message: raw || fallback }
}
