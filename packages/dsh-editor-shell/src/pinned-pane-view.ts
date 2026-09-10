import type { CharacterCardFields, WorldbookCardFields } from 'dsh-editor-workbench/contracts'
import { t, type MessageKey } from './i18n/index.ts'

const CATEGORY_LABELS: Record<string, MessageKey> = {
  地点: 'cards.category.place',
  势力: 'cards.category.faction',
  物品: 'cards.category.item',
  规则: 'cards.category.rule',
  历史: 'cards.category.history',
  其他: 'cards.category.other',
}

export function isCharacterCardPath(path: string): boolean {
  return /^人物卡\/.+\.md$/i.test(path)
}

export function isWorldbookCardPath(path: string): boolean {
  return /^世界书\/.+\.md$/i.test(path)
}

export function formatListInput(values: readonly string[] | undefined): string {
  return (values ?? []).join('，')
}

export function worldbookCategoryLabel(category: string): string {
  return category in CATEGORY_LABELS ? t(CATEGORY_LABELS[category]!) : category
}

export type PinnedPaneKind = 'card' | 'worldbook' | 'chapter' | 'text'

export type PinnedFieldRow = { label: MessageKey; value: string }

export function canPinPath(path: string): boolean {
  return /\.(?:md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.'))
}

export function pinnedPaneKind(path: string): PinnedPaneKind {
  if (isCharacterCardPath(path)) return 'card'
  if (isWorldbookCardPath(path)) return 'worldbook'
  if (/^正文\/.+\.(?:md|txt)$/i.test(path)) return 'chapter'
  return 'text'
}

export function pinnedLayoutColumns(input: {
  sidebarVisible: boolean
  sidebarWidth: number
  pinnedVisible: boolean
  pinnedWidth: number
  assistantVisible: boolean
  assistantWidth: number
}): string {
  return [
    input.sidebarVisible ? `${input.sidebarWidth}px 7px` : '',
    'minmax(420px,1fr)',
    input.pinnedVisible ? `7px ${input.pinnedWidth}px` : '',
    input.assistantVisible ? `7px ${input.assistantWidth}px` : '',
  ].filter(Boolean).join(' ')
}

export function validatePinnedPath(stored: string | null | undefined, treePaths: readonly string[]): string | null {
  if (!stored || !canPinPath(stored)) return null
  return treePaths.includes(stored) ? stored : null
}

export function storedPinnedPath(key: string): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw && raw.length ? raw : null
  } catch {
    return null
  }
}

export function characterPinnedFields(fields: CharacterCardFields): PinnedFieldRow[] {
  const rows: PinnedFieldRow[] = []
  if (fields.name) rows.push({ label: 'cards.name', value: fields.name })
  if (fields.aliases?.length) rows.push({ label: 'cards.aliases', value: formatListInput(fields.aliases) })
  if (fields.role) rows.push({ label: 'cards.role', value: fields.role })
  if (fields.gender) rows.push({ label: 'cards.gender', value: fields.gender })
  if (fields.age) rows.push({ label: 'cards.age', value: fields.age })
  if (fields.faction) rows.push({ label: 'cards.faction', value: fields.faction })
  if (fields.status) rows.push({ label: 'cards.status', value: fields.status })
  if (fields.tags?.length) rows.push({ label: 'cards.tags', value: formatListInput(fields.tags) })
  if (fields.relations?.length) {
    rows.push({
      label: 'cards.relations',
      value: fields.relations.map((row) => `${row.to} · ${row.kind}`).join('，'),
    })
  }
  if (fields.summary) rows.push({ label: 'cards.summary', value: fields.summary })
  return rows
}

export function worldbookPinnedFields(fields: WorldbookCardFields): PinnedFieldRow[] {
  const rows: PinnedFieldRow[] = []
  if (fields.category) rows.push({ label: 'cards.category', value: worldbookCategoryLabel(fields.category) })
  if (fields.tags?.length) rows.push({ label: 'cards.tags', value: formatListInput(fields.tags) })
  if (fields.summary) rows.push({ label: 'cards.summary', value: fields.summary })
  return rows
}
