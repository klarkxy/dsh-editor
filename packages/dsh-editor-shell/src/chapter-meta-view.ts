import {
  CHAPTER_STATE_KEYS,
  formatChapterContextText,
  parseChapterMeta,
  type ChapterMetaFields,
  type ChapterStateFields,
} from 'dsh-editor-workbench/contracts'
import { sortChapterPaths } from './project-files.ts'

export function isChapterMetaPath(path: string): boolean {
  return /^正文\/.+\.md$/i.test(path)
}

export function beatsFromTextarea(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function beatsToTextarea(beats?: readonly string[]): string {
  return (beats ?? []).join('\n')
}

export function stateTotalChars(state?: ChapterStateFields): number {
  if (!state) return 0
  let total = 0
  for (const key of CHAPTER_STATE_KEYS) {
    const value = state[key]
    if (typeof value === 'string') total += value.trim().length
  }
  return total
}

export type ChapterMetaForm = {
  beats: string[]
  state: ChapterStateFields
}

function normalizeState(state?: ChapterStateFields): ChapterStateFields | undefined {
  if (!state) return undefined
  const next: ChapterStateFields = {}
  for (const key of CHAPTER_STATE_KEYS) {
    const value = state[key]?.trim()
    if (value) next[key] = value
  }
  return CHAPTER_STATE_KEYS.some((key) => next[key]) ? next : undefined
}

function sameBeats(left?: readonly string[], right?: readonly string[]): boolean {
  const a = (left ?? []).map((item) => item.trim()).filter(Boolean)
  const b = (right ?? []).map((item) => item.trim()).filter(Boolean)
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function sameState(left?: ChapterStateFields, right?: ChapterStateFields): boolean {
  const a = normalizeState(left)
  const b = normalizeState(right)
  if (!a && !b) return true
  if (!a || !b) return false
  return CHAPTER_STATE_KEYS.every((key) => (a[key] ?? '') === (b[key] ?? ''))
}

/** Only include keys that changed. Empty beats/state mean removal for `applyChapterMeta`. */
export function chapterMetaPatch(
  current: ChapterMetaFields | undefined,
  form: ChapterMetaForm,
): Partial<ChapterMetaFields> {
  const patch: Partial<ChapterMetaFields> = {}
  const nextBeats = form.beats.map((item) => item.trim()).filter(Boolean)
  if (!sameBeats(current?.beats, nextBeats)) patch.beats = nextBeats
  const nextState = normalizeState(form.state)
  if (!sameState(current?.state, nextState)) patch.state = nextState ?? {}
  return patch
}

export type PreviousChapterState = { path: string; state: ChapterStateFields }

/** The chapter right before `path` in natural manuscript order, or undefined at the first chapter. */
export function previousChapterPath(path: string, files: readonly string[]): string | undefined {
  const ordered = sortChapterPaths(files.includes(path) ? files : [...files, path])
  const index = ordered.indexOf(path)
  return index > 0 ? ordered[index - 1] : undefined
}

/** Previous chapter's end-state table, or undefined when the file carries no non-empty state. */
export function previousChapterState(path: string, text: string): PreviousChapterState | undefined {
  const state = normalizeState(parseChapterMeta(text)?.state)
  return state ? { path, state } : undefined
}

/** Current-chapter beats plus the previous chapter's end state, formatted for FIM / rewrite prompts. */
export function chapterContextFor(text: string, previous?: PreviousChapterState): string | undefined {
  const beats = parseChapterMeta(text)?.beats?.map((item) => item.trim()).filter(Boolean)
  if (!beats?.length && !previous) return undefined
  return formatChapterContextText({
    beats: beats?.length ? beats : undefined,
    previousState: previous?.state,
    previousPath: previous?.path,
  }) || undefined
}
