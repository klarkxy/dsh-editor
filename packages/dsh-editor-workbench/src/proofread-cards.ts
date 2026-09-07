import type { CharacterCard, CardsListResponse, WorldbookCard } from './contracts.ts'

export const CARD_GENDER_MAX_PER_CARD_FILE = 3
export const CARD_NEARMISS_TERM_LIMIT = 400
export const CARD_NEARMISS_MAX_FINDINGS = 200
export const CARD_NEARMISS_MAX_OCCURRENCES = 3
export const CARD_NEARMISS_SKIP_REASON = 'card-nearmiss: term set exceeds 400'

const SENTENCE_DELIMS = new Set(['。', '！', '？', '!', '?', '；', ';', '\n', '”', '」'])
const FUNCTION_CHARS = new Set('的地得了着过和与及或在是就都也还很把被让给对从到向往将而但却并且又吗呢吧啊呀嘛么'.split(''))

export type CardFindingDraft = {
  path?: string
  start: number
  end: number
  severity: 'warning' | 'info'
  message: string
  suggestion?: string
  code: string
  term?: string
}

export type GenderedCharacter = {
  name: string
  terms: string[]
  gender: '男' | '女'
}

export type CardNearmissHit = {
  path: string
  start: number
  end: number
  candidate: string
  term: string
}

export type CardProofreadIndex = {
  characters: GenderedCharacter[]
  oppositeTerms: { 男: string[]; 女: string[] }
  nearmiss: {
    skipped: boolean
    skipReason?: string
    terms: string[]
    termSet: Set<string>
    byLength: Map<number, string[]>
  }
}

export function normalizeCardGender(value: string | undefined): '男' | '女' | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === '男' || normalized === 'male' || normalized === '男性') return '男'
  if (normalized === '女' || normalized === 'female' || normalized === '女性') return '女'
  return undefined
}

function isCjk(code: number): boolean {
  return (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)
}

function isCjkAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && isCjk(text.charCodeAt(index))
}

function isAnalyzed(text: string, index: number): boolean {
  const ch = text[index]
  return ch !== undefined && ch !== '\0'
}

function allAnalyzed(text: string, start: number, end: number): boolean {
  if (end <= start) return false
  for (let index = start; index < end; index++) {
    if (!isAnalyzed(text, index)) return false
  }
  return true
}

function isCjkTerm(value: string): boolean {
  if (value.length < 2 || value.length > 8) return false
  for (let index = 0; index < value.length; index++) {
    if (!isCjk(value.charCodeAt(index))) return false
  }
  return true
}

function uniqueTerms(values: readonly string[]): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(value)
  }
  return terms
}

function characterTerms(card: CharacterCard): string[] {
  return uniqueTerms([card.frontmatter.name ?? card.title, ...(card.frontmatter.aliases ?? [])])
}

function worldbookTerms(card: WorldbookCard): string[] {
  return uniqueTerms(card.frontmatter.triggers ?? [])
}

export function buildCardProofreadIndex(listed: Pick<CardsListResponse, 'characters' | 'worldbook'>): CardProofreadIndex {
  const characters: GenderedCharacter[] = []
  const oppositeTerms: { 男: string[]; 女: string[] } = { 男: [], 女: [] }
  const rawTerms: string[] = []
  for (const card of listed.characters) {
    const terms = characterTerms(card)
    rawTerms.push(...terms)
    const gender = normalizeCardGender(card.frontmatter.gender)
    if (!gender || !terms.length) continue
    const name = (card.frontmatter.name ?? card.title).trim() || terms[0]!
    characters.push({ name, terms, gender })
    oppositeTerms[gender].push(...terms)
  }
  for (const card of listed.worldbook) rawTerms.push(...worldbookTerms(card))

  const cjkTerms = uniqueTerms(rawTerms).filter(isCjkTerm)
  if (cjkTerms.length > CARD_NEARMISS_TERM_LIMIT) {
    return {
      characters,
      oppositeTerms,
      nearmiss: { skipped: true, skipReason: CARD_NEARMISS_SKIP_REASON, terms: [], termSet: new Set(), byLength: new Map() },
    }
  }

  const terms = cjkTerms.filter((term) => {
    const key = term.toLocaleLowerCase()
    return !cjkTerms.some((other) => other.length > term.length && other.toLocaleLowerCase().includes(key))
  })
  const termSet = new Set(terms.map((term) => term.toLocaleLowerCase()))
  const byLength = new Map<number, string[]>()
  for (const term of terms) {
    const bucket = byLength.get(term.length)
    if (bucket) bucket.push(term)
    else byLength.set(term.length, [term])
  }
  return { characters, oppositeTerms, nearmiss: { skipped: false, terms, termSet, byLength } }
}

function isSentenceDelim(ch: string): boolean {
  return SENTENCE_DELIMS.has(ch)
}

export function sentenceBounds(text: string, index: number): { start: number; end: number } {
  let start = index
  while (start > 0 && !isSentenceDelim(text[start - 1]!)) start--
  let end = index
  while (end < text.length && !isSentenceDelim(text[end]!)) end++
  return { start, end }
}

function analyzedIndexOf(text: string, term: string, from = 0): number {
  if (!term) return -1
  let index = from
  while (index <= text.length - term.length) {
    if (text.startsWith(term, index) && allAnalyzed(text, index, index + term.length)) return index
    index++
  }
  return -1
}

function containsAnalyzed(text: string, start: number, end: number, term: string): boolean {
  const slice = text.slice(start, end)
  return analyzedIndexOf(slice, term) >= 0
}

function containsAnyAnalyzed(text: string, start: number, end: number, terms: readonly string[]): boolean {
  return terms.some((term) => containsAnalyzed(text, start, end, term))
}

function isPluralPronoun(text: string, index: number): boolean {
  return text[index + 1] === '们'
}

function forEachSentence(text: string, visit: (start: number, end: number) => void): void {
  let start = 0
  for (let index = 0; index <= text.length; index++) {
    if (index === text.length || isSentenceDelim(text[index]!)) {
      if (index > start) visit(start, index)
      start = index + 1
    }
  }
}

export function scanCardGender(masked: string, index: CardProofreadIndex): CardFindingDraft[] {
  const drafts: CardFindingDraft[] = []
  for (const card of index.characters) {
    let emitted = 0
    forEachSentence(masked, (start, end) => {
      if (emitted >= CARD_GENDER_MAX_PER_CARD_FILE) return
      if (!containsAnyAnalyzed(masked, start, end, card.terms)) return
      const opposite = card.gender === '男' ? '她' : '他'
      const otherNames = index.oppositeTerms[card.gender === '男' ? '女' : '男'].filter((term) => !card.terms.includes(term))
      if (containsAnyAnalyzed(masked, start, end, otherNames)) return
      for (let pos = start; pos < end && emitted < CARD_GENDER_MAX_PER_CARD_FILE; pos++) {
        if (masked[pos] !== opposite || !isAnalyzed(masked, pos) || isPluralPronoun(masked, pos)) continue
        drafts.push({
          start: pos,
          end: pos + 1,
          severity: 'warning',
          message: `“${card.name}”在人物卡中为${card.gender}，此处用了“${opposite}”`,
          suggestion: card.gender === '男' ? '他' : '她',
          code: 'card-gender',
        })
        emitted++
      }
    })
  }
  return drafts
}

function hammingOne(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diffs = 0
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index] && ++diffs > 1) return false
  }
  return diffs === 1
}

function oneEditShorter(shorter: string, longer: string): boolean {
  if (longer.length !== shorter.length + 1) return false
  let i = 0
  let j = 0
  let skipped = 0
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++
      j++
      continue
    }
    if (++skipped > 1) return false
    j++
  }
  return true
}

function isKnownOrSubterm(candidate: string, nearmiss: CardProofreadIndex['nearmiss']): boolean {
  const key = candidate.toLocaleLowerCase()
  if (nearmiss.termSet.has(key)) return true
  return nearmiss.terms.some((term) => term.length > candidate.length && term.toLocaleLowerCase().includes(key))
}

function firstNearmissTerm(candidate: string, terms: readonly string[]): string | undefined {
  for (const term of terms) {
    if (candidate.length === term.length && hammingOne(candidate, term)) return term
    if (term.length >= 3 && candidate.length === term.length - 1 && oneEditShorter(candidate, term)) return term
    if (term.length >= 3 && candidate.length === term.length + 1 && oneEditShorter(term, candidate)) return term
  }
  return undefined
}

function isCjkRunChar(text: string, index: number): boolean {
  return isCjkAt(text, index) && isAnalyzed(text, index) && !FUNCTION_CHARS.has(text[index]!)
}

function adjacentExtendsKnownTerm(masked: string, start: number, end: number, nearmiss: CardProofreadIndex['nearmiss']): boolean {
  if (isCjkRunChar(masked, start - 1)) {
    const grown = masked.slice(start - 1, end)
    if (nearmiss.termSet.has(grown.toLocaleLowerCase())) return true
  }
  if (isCjkRunChar(masked, end)) {
    const grown = masked.slice(start, end + 1)
    if (nearmiss.termSet.has(grown.toLocaleLowerCase())) return true
  }
  return false
}

export function collectCardNearmiss(masked: string, path: string, index: CardProofreadIndex): CardNearmissHit[] {
  if (index.nearmiss.skipped || !index.nearmiss.terms.length) return []
  const hits: CardNearmissHit[] = []
  const seen = new Set<string>()
  let cursor = 0
  while (cursor < masked.length) {
    if (!isCjkRunChar(masked, cursor)) {
      cursor++
      continue
    }
    let end = cursor + 1
    while (end < masked.length && isCjkRunChar(masked, end)) end++
    const candidate = masked.slice(cursor, end)
    const runLength = candidate.length
    if (runLength > 10) {
      cursor = end
      continue
    }
    const termLengths = [runLength]
    if (runLength + 1 >= 3) termLengths.push(runLength + 1)
    if (runLength - 1 >= 3) termLengths.push(runLength - 1)
    for (const termLen of termLengths) {
      if (runLength > termLen + 2) continue
      const terms = index.nearmiss.byLength.get(termLen)
      if (!terms) continue
      if (isKnownOrSubterm(candidate, index.nearmiss)) continue
      if (adjacentExtendsKnownTerm(masked, cursor, end, index.nearmiss)) continue
      const term = firstNearmissTerm(candidate, terms)
      if (!term) continue
      const key = `${cursor}:${end}:${term}`
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ path, start: cursor, end, candidate, term })
    }
    cursor = end
  }
  return hits
}

export function countAnalyzedOccurrences(masked: string, term: string): number {
  let count = 0
  let index = 0
  while (index <= masked.length - term.length) {
    if (masked.startsWith(term, index) && allAnalyzed(masked, index, index + term.length)) {
      count++
      index += term.length
    } else {
      index++
    }
  }
  return count
}

export function emitCardNearmiss(
  hits: readonly CardNearmissHit[],
  files: readonly { path: string; masked: string }[],
): CardFindingDraft[] {
  if (!hits.length) return []
  const maskedByPath = new Map(files.map((file) => [file.path, file.masked]))
  const counts = new Map<string, number>()
  const candidates = [...new Set(hits.map((hit) => hit.candidate))]
  for (const candidate of candidates) {
    let total = 0
    for (const file of files) total += countAnalyzedOccurrences(file.masked, candidate)
    counts.set(candidate, total)
  }
  const drafts: CardFindingDraft[] = []
  for (const hit of hits) {
    if (drafts.length >= CARD_NEARMISS_MAX_FINDINGS) break
    if ((counts.get(hit.candidate) ?? 0) > CARD_NEARMISS_MAX_OCCURRENCES) continue
    const masked = maskedByPath.get(hit.path)
    if (!masked) continue
    const bounds = sentenceBounds(masked, hit.start)
    if (containsAnalyzed(masked, bounds.start, bounds.end, hit.term)) continue
    drafts.push({
      path: hit.path,
      start: hit.start,
      end: hit.end,
      severity: 'info',
      message: `“${hit.candidate}”疑似与设定“${hit.term}”写法不一致`,
      suggestion: hit.term,
      code: 'card-nearmiss',
      term: hit.term,
    })
  }
  return drafts
}
