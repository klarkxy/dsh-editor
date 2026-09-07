import { createElement as e, useState, type ChangeEvent } from 'react'
import {
  CHAPTER_STATE_KEYS,
  CHAPTER_STATE_MAX_TOTAL_CHARS,
  applyChapterMeta,
  parseChapterMeta,
  validateChapterMeta,
  type ChapterStateFields,
} from 'dsh-editor-workbench/contracts'
import { t, type MessageKey } from '../i18n/index.ts'
import {
  beatsFromTextarea,
  beatsToTextarea,
  chapterMetaPatch,
  isChapterMetaPath,
  stateTotalChars,
} from '../chapter-meta-view.ts'

const CHAPTER_META_OPEN_KEY = 'dsh-editor.chapter-meta.open'

const STATE_LABELS: Record<(typeof CHAPTER_STATE_KEYS)[number], MessageKey> = {
  now: 'chapterMeta.stateNow',
  where: 'chapterMeta.stateWhere',
  knows: 'chapterMeta.stateKnows',
  ended: 'chapterMeta.stateEnded',
  open: 'chapterMeta.stateOpen',
}

export { isChapterMetaPath }

export type ChapterMetaSettingsInput = {
  beats: string
  state: ChapterStateFields
}

export type ChapterMetaApplyResult =
  | { ok: true; text: string; note: string }
  | { ok: false; note: string }

function readChapterMetaOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAPTER_META_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeChapterMetaOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(CHAPTER_META_OPEN_KEY, String(open))
  } catch { /* View preference is optional. */ }
}

function formFields(input: ChapterMetaSettingsInput) {
  const beats = beatsFromTextarea(input.beats)
  const state: ChapterStateFields = {}
  for (const key of CHAPTER_STATE_KEYS) {
    const value = (input.state[key] ?? '').split(/\r?\n/, 1)[0]?.trim() ?? ''
    if (value) state[key] = value
  }
  return {
    beats,
    state,
    fields: {
      ...(beats.length ? { beats } : {}),
      ...(CHAPTER_STATE_KEYS.some((key) => state[key]) ? { state } : {}),
    },
  }
}

export function applyChapterMetaSettings(text: string, input: ChapterMetaSettingsInput): ChapterMetaApplyResult {
  const current = parseChapterMeta(text)
  if (current === undefined) return { ok: false, note: t('chapterMeta.unclosed') }
  const { beats, state, fields } = formFields(input)
  const issues = validateChapterMeta(fields)
  if (issues.length) return { ok: false, note: issues.join('；') }
  const patch = chapterMetaPatch(current, { beats, state })
  if (!Object.keys(patch).length) return { ok: true, text, note: t('chapterMeta.unchanged') }
  try {
    return { ok: true, text: applyChapterMeta(text, patch), note: t('chapterMeta.addedDraft') }
  } catch (error) {
    return { ok: false, note: error instanceof Error ? error.message : t('chapterMeta.applyFailed') }
  }
}

function ChapterMetaSettings(props: {
  path: string
  text: string
  onChange(text: string): void
  onNote(note: string): void
}) {
  const parsed = parseChapterMeta(props.text)
  const valid = parsed !== undefined
  const current = parsed ?? {}
  const [open, setOpen] = useState(readChapterMetaOpen)
  const [beats, setBeats] = useState(beatsToTextarea(current.beats))
  const [state, setState] = useState<ChapterStateFields>({
    now: current.state?.now ?? '',
    where: current.state?.where ?? '',
    knows: current.state?.knows ?? '',
    ended: current.state?.ended ?? '',
    open: current.state?.open ?? '',
  })
  const form = formFields({ beats, state })
  const issues = valid ? validateChapterMeta(form.fields) : [t('chapterMeta.unclosed')]
  const used = stateTotalChars(state)
  const apply = () => {
    const result = applyChapterMetaSettings(props.text, { beats, state })
    props.onNote(result.note)
    if (result.ok && result.text !== props.text) props.onChange(result.text)
  }
  const setField = (key: (typeof CHAPTER_STATE_KEYS)[number], value: string) => {
    setState((prev) => ({ ...prev, [key]: value }))
  }
  return e('details', {
    className: 'chapter-meta-settings',
    open,
    onToggle: (event: ChangeEvent<HTMLDetailsElement>) => {
      const next = event.currentTarget.open
      if (next === open) return
      setOpen(next)
      writeChapterMetaOpen(next)
    },
  },
    e('summary', { 'aria-label': t('chapterMeta.toggle') }, t('chapterMeta.title')),
    e('div', { className: 'chapter-meta-body' },
      e('p', { className: 'muted' }, t('chapterMeta.hint')),
      e('label', null,
        e('span', null, t('chapterMeta.beats')),
        e('small', null, t('chapterMeta.beatsHint')),
        e('textarea', {
          value: beats,
          disabled: !valid,
          rows: Math.min(8, Math.max(3, beats.split(/\r?\n/).length)),
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setBeats(event.target.value),
          'aria-label': t('chapterMeta.beatsAria'),
        }),
      ),
      e('div', { className: 'chapter-meta-state', 'aria-label': t('chapterMeta.state') },
        ...CHAPTER_STATE_KEYS.map((key) => e('label', { key },
          e('span', null, t(STATE_LABELS[key])),
          e('input', {
            type: 'text',
            value: state[key] ?? '',
            disabled: !valid,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setField(key, event.target.value),
            'aria-label': t(STATE_LABELS[key]),
          }),
        )),
      ),
      e('small', {
        className: used > CHAPTER_STATE_MAX_TOTAL_CHARS ? 'chapter-meta-count over' : 'chapter-meta-count',
      }, t('chapterMeta.stateCount', { used, max: CHAPTER_STATE_MAX_TOTAL_CHARS })),
      issues.length ? e('span', { className: 'warning', role: 'alert' }, issues.join('；')) : null,
      e('button', { type: 'button', onClick: apply, disabled: !valid || issues.length > 0 }, t('chapterMeta.apply')),
    ),
  )
}

export { ChapterMetaSettings }
