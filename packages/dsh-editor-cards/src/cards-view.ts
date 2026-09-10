import type {
  CardReferenceHit,
  CharacterCard,
  WorldbookCard,
} from './contracts.ts'
import { intlLocale, t } from './client/messages.ts'

export const UNGROUPED_ROLE = '未分组'
export const UNGROUPED_CATEGORY = '其他'
export const WORLDBOOK_CATEGORIES = ['地点', '势力', '物品', '规则', '历史', '其他'] as const

export type WorldbookCategoryPreset = typeof WORLDBOOK_CATEGORIES[number]

const CATEGORY_LABELS: Record<WorldbookCategoryPreset, 'cards.category.place' | 'cards.category.faction' | 'cards.category.item' | 'cards.category.rule' | 'cards.category.history' | 'cards.category.other'> = {
  地点: 'cards.category.place',
  势力: 'cards.category.faction',
  物品: 'cards.category.item',
  规则: 'cards.category.rule',
  历史: 'cards.category.history',
  其他: 'cards.category.other',
}

export function worldbookCategoryLabel(category: string): string {
  return category in CATEGORY_LABELS ? t(CATEGORY_LABELS[category as WorldbookCategoryPreset]) : category
}

export function ungroupedRoleLabel(): string {
  return t('cards.ungrouped')
}
export type CardSortKey = 'title' | 'modified' | 'role' | 'category'

export type CharacterCardFilter = {
  text: string
  roles: readonly string[]
  tags: readonly string[]
  sort?: CardSortKey
}

export type WorldbookCardFilter = {
  text: string
  categories: readonly string[]
  tags: readonly string[]
  sort?: CardSortKey
}

export type CardGroup<T> = { key: string; label: string; cards: T[] }

export type RelationEdge = {
  fromPath: string
  fromTitle: string
  to: string
  kind: string
  targetPath: string | null
  targetTitle: string | null
}

export type GroupedCardReferences = { path: string; title: string; hits: CardReferenceHit[] }[]

const NAME_COMPARE: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' }

export function isCharacterCardPath(path: string): boolean {
  return /^人物卡\/.+\.md$/i.test(path)
}

export function isWorldbookCardPath(path: string): boolean {
  return /^世界书\/.+\.md$/i.test(path)
}

export function isCardAreaPath(path: string): boolean {
  return isCharacterCardPath(path) || isWorldbookCardPath(path)
}

export function characterGroupKey(card: Pick<CharacterCard, 'frontmatter'>): string {
  return card.frontmatter.role?.trim() || UNGROUPED_ROLE
}

export function worldbookGroupKey(card: Pick<WorldbookCard, 'frontmatter'>): string {
  return card.frontmatter.category?.trim() || UNGROUPED_CATEGORY
}

export function toggleFilterValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function uniqueFolded(values: readonly (string | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    if (!raw) continue
    const value = raw.trim()
    if (!value) continue
    const folded = value.toLocaleLowerCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    out.push(value)
  }
  return out
}

export function parseListInput(value: string): string[] {
  return uniqueFolded(value.split(/[,，\r\n]/))
}

export function formatListInput(values: readonly string[] | undefined): string {
  return (values ?? []).join('，')
}

export function collectTags(cards: readonly { frontmatter: { tags?: string[] } }[]): string[] {
  return uniqueFolded(cards.flatMap((card) => card.frontmatter.tags ?? [])).sort((left, right) => (
    left.localeCompare(right, intlLocale(), NAME_COMPARE)
  ))
}

export function collectCharacterRoles(cards: readonly CharacterCard[]): string[] {
  const roles = new Set<string>()
  let ungrouped = false
  for (const card of cards) {
    const role = card.frontmatter.role?.trim()
    if (role) roles.add(role)
    else ungrouped = true
  }
  const named = [...roles].sort((left, right) => left.localeCompare(right, intlLocale(), NAME_COMPARE))
  return ungrouped ? [...named, UNGROUPED_ROLE] : named
}

export function collectWorldbookCategories(cards: readonly WorldbookCard[]): string[] {
  const categories = new Set<string>()
  let ungrouped = false
  for (const card of cards) {
    const category = card.frontmatter.category?.trim()
    if (category) categories.add(category)
    else ungrouped = true
  }
  const named = [...categories].sort((left, right) => left.localeCompare(right, intlLocale(), NAME_COMPARE))
  return ungrouped && !named.includes(UNGROUPED_CATEGORY) ? [...named, UNGROUPED_CATEGORY] : named
}

function foldHaystack(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join('\n').toLocaleLowerCase()
}

function characterHaystack(card: CharacterCard): string {
  const fields = card.frontmatter
  return foldHaystack([
    card.title,
    card.summary,
    card.path,
    fields.name,
    fields.role,
    fields.faction,
    fields.status,
    fields.gender,
    fields.age,
    ...(fields.aliases ?? []),
    ...(fields.tags ?? []),
  ])
}

function worldbookHaystack(card: WorldbookCard): string {
  const fields = card.frontmatter
  return foldHaystack([
    card.title,
    card.summary,
    card.path,
    fields.category,
    ...(fields.triggers ?? []),
    ...(fields.tags ?? []),
  ])
}

function matchesText(haystack: string, text: string): boolean {
  const query = text.trim().toLocaleLowerCase()
  return !query || haystack.includes(query)
}

function matchesTags(cardTags: readonly string[] | undefined, selected: readonly string[]): boolean {
  if (!selected.length) return true
  const have = new Set((cardTags ?? []).map((tag) => tag.toLocaleLowerCase()))
  return selected.some((tag) => have.has(tag.toLocaleLowerCase()))
}

export function filterCharacterCards(cards: readonly CharacterCard[], filter: CharacterCardFilter): CharacterCard[] {
  return cards.filter((card) => {
    if (!matchesText(characterHaystack(card), filter.text)) return false
    if (!matchesTags(card.frontmatter.tags, filter.tags)) return false
    if (!filter.roles.length) return true
    return filter.roles.includes(characterGroupKey(card))
  })
}

export function filterWorldbookCards(cards: readonly WorldbookCard[], filter: WorldbookCardFilter): WorldbookCard[] {
  return cards.filter((card) => {
    if (!matchesText(worldbookHaystack(card), filter.text)) return false
    if (!matchesTags(card.frontmatter.tags, filter.tags)) return false
    if (!filter.categories.length) return true
    return filter.categories.includes(worldbookGroupKey(card))
  })
}

function compareTitle(left: { title: string; path: string }, right: { title: string; path: string }): number {
  return left.title.localeCompare(right.title, intlLocale(), NAME_COMPARE) || left.path.localeCompare(right.path, intlLocale(), NAME_COMPARE)
}

function compareModified(left: { modifiedAt: string | null; title: string; path: string }, right: { modifiedAt: string | null; title: string; path: string }): number {
  const leftStamp = left.modifiedAt ? Date.parse(left.modifiedAt) : Number.NaN
  const rightStamp = right.modifiedAt ? Date.parse(right.modifiedAt) : Number.NaN
  const leftValue = Number.isFinite(leftStamp) ? leftStamp : 0
  const rightValue = Number.isFinite(rightStamp) ? rightStamp : 0
  return rightValue - leftValue || compareTitle(left, right)
}

export function sortCharacterCards(cards: readonly CharacterCard[], sort: CardSortKey = 'title'): CharacterCard[] {
  const copy = [...cards]
  if (sort === 'modified') return copy.sort(compareModified)
  if (sort === 'role') {
    return copy.sort((left, right) => (
      characterGroupKey(left).localeCompare(characterGroupKey(right), intlLocale(), NAME_COMPARE) || compareTitle(left, right)
    ))
  }
  return copy.sort(compareTitle)
}

export function sortWorldbookCards(cards: readonly WorldbookCard[], sort: CardSortKey = 'title'): WorldbookCard[] {
  const copy = [...cards]
  if (sort === 'modified') return copy.sort(compareModified)
  if (sort === 'category') {
    return copy.sort((left, right) => (
      worldbookGroupKey(left).localeCompare(worldbookGroupKey(right), intlLocale(), NAME_COMPARE) || compareTitle(left, right)
    ))
  }
  return copy.sort(compareTitle)
}

export function visibleCharacterCards(cards: readonly CharacterCard[], filter: CharacterCardFilter): CharacterCard[] {
  return sortCharacterCards(filterCharacterCards(cards, filter), filter.sort ?? 'title')
}

export function visibleWorldbookCards(cards: readonly WorldbookCard[], filter: WorldbookCardFilter): WorldbookCard[] {
  return sortWorldbookCards(filterWorldbookCards(cards, filter), filter.sort ?? 'title')
}

function groupCards<T>(cards: readonly T[], keyOf: (card: T) => string, ungrouped: string): CardGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const card of cards) {
    const key = keyOf(card)
    const list = map.get(key)
    if (list) list.push(card)
    else map.set(key, [card])
  }
  const keys = [...map.keys()].sort((left, right) => {
    if (left === ungrouped) return 1
    if (right === ungrouped) return -1
    return left.localeCompare(right, intlLocale(), NAME_COMPARE)
  })
  return keys.map((key) => ({ key, label: key, cards: map.get(key)! }))
}

export function groupCharacterCards(cards: readonly CharacterCard[]): CardGroup<CharacterCard>[] {
  return groupCards(cards, characterGroupKey, UNGROUPED_ROLE)
}

export function groupWorldbookCards(cards: readonly WorldbookCard[]): CardGroup<WorldbookCard>[] {
  return groupCards(cards, worldbookGroupKey, UNGROUPED_CATEGORY)
}

export function characterMatchTerms(card: Pick<CharacterCard, 'title' | 'frontmatter'>): string[] {
  return uniqueFolded([card.frontmatter.name, card.title, ...(card.frontmatter.aliases ?? [])])
}

function foldTerm(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function resolveRelationTarget(to: string, cards: readonly CharacterCard[]): CharacterCard | undefined {
  const needle = foldTerm(to)
  if (!needle) return undefined
  return cards.find((card) => characterMatchTerms(card).some((term) => foldTerm(term) === needle))
}

export function relationEdges(cards: readonly CharacterCard[]): RelationEdge[] {
  const edges: RelationEdge[] = []
  for (const card of cards) {
    for (const relation of card.frontmatter.relations ?? []) {
      const target = resolveRelationTarget(relation.to, cards)
      edges.push({
        fromPath: card.path,
        fromTitle: card.title,
        to: relation.to,
        kind: relation.kind,
        targetPath: target?.path ?? null,
        targetTitle: target?.title ?? null,
      })
    }
  }
  return edges
}

export function chapterTitleFromPath(path: string): string {
  return path.replace(/^正文\//, '').replace(/\.(md|txt)$/i, '')
}

export function groupReferencesByChapter(hits: readonly CardReferenceHit[]): GroupedCardReferences {
  const groups = new Map<string, CardReferenceHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.path)
    if (list) list.push(hit)
    else groups.set(hit.path, [hit])
  }
  return [...groups.entries()]
    .map(([path, groupHits]) => ({
      path,
      title: chapterTitleFromPath(path),
      hits: [...groupHits].sort((left, right) => left.start - right.start || left.line - right.line),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, intlLocale(), NAME_COMPARE))
}

export function worldbookCategoryValue(category: string | undefined, custom: string): string {
  if (category === '__custom__') return custom.trim()
  return category?.trim() ?? ''
}
