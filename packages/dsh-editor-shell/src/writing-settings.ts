import type { SettingsScope, SettingsScopeSnapshot } from './dsh-compat.ts'
import { createElement as e, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import { AUTHOR_PREFERENCES_KEY, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { COMPLETION_PREFERENCE_KEY, type CompletionPreference } from './completion-preference.ts'
import { WRITING_SETTINGS_NAMESPACE, type PaperFontFamily, type PaperWidth, type WritingPreferences } from './writing-settings-contract.ts'
import { WritingProgressSettings } from './writing-progress-settings.tsx'
import type { WritingProgressScope } from './writing-progress.ts'
import { t, useLocale } from './i18n/index.ts'


export { WRITING_SETTINGS_NAMESPACE, type PaperFontFamily, type PaperWidth, type WritingPreferences } from './writing-settings-contract.ts'

export const PAPER_FONT_SIZE = { min: 14, max: 28, default: 17 } as const
export const PAPER_LINE_HEIGHT = { min: 1.4, max: 2.4, default: 1.9 } as const
export const PAPER_PARAGRAPH_SPACING = { min: 0, max: 1.5, default: 0 } as const
export const PAPER_WIDTH_CH = { narrow: 60, medium: 76 } as const

export const DEFAULT_WRITING_PREFERENCES: WritingPreferences = {
  completion: 'manual',
  authorPreferences: '',
  authorMemory: '',
  typewriter: false,
  focusParagraph: false,
  fontSize: PAPER_FONT_SIZE.default,
  lineHeight: PAPER_LINE_HEIGHT.default,
  fontFamily: 'serif',
  paragraphSpacing: PAPER_PARAGRAPH_SPACING.default,
  paperWidth: 'wide',
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizePaperFontFamily(value: unknown): PaperFontFamily {
  return value === 'sans' || value === 'mono' || value === 'serif' ? value : 'serif'
}

export function normalizePaperWidth(value: unknown): PaperWidth {
  return value === 'narrow' || value === 'medium' || value === 'wide' ? value : 'wide'
}

export function paperWidthToMaxWidth(width: PaperWidth): number | undefined {
  return width === 'wide' ? undefined : PAPER_WIDTH_CH[width]
}

export function writingTypography(prefs: Pick<WritingPreferences, 'fontSize' | 'lineHeight' | 'fontFamily' | 'paragraphSpacing' | 'paperWidth'>) {
  return {
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    fontFamily: prefs.fontFamily,
    paragraphSpacing: prefs.paragraphSpacing,
    maxWidth: paperWidthToMaxWidth(prefs.paperWidth),
  }
}

function normalizePaperPreferences(record: Record<string, unknown>): Pick<WritingPreferences, 'typewriter' | 'focusParagraph' | 'fontSize' | 'lineHeight' | 'fontFamily' | 'paragraphSpacing' | 'paperWidth'> {
  return {
    typewriter: record.typewriter === true,
    focusParagraph: record.focusParagraph === true,
    fontSize: clampNumber(record.fontSize, PAPER_FONT_SIZE.min, PAPER_FONT_SIZE.max, PAPER_FONT_SIZE.default),
    lineHeight: clampNumber(record.lineHeight, PAPER_LINE_HEIGHT.min, PAPER_LINE_HEIGHT.max, PAPER_LINE_HEIGHT.default),
    fontFamily: normalizePaperFontFamily(record.fontFamily),
    paragraphSpacing: clampNumber(record.paragraphSpacing, PAPER_PARAGRAPH_SPACING.min, PAPER_PARAGRAPH_SPACING.max, PAPER_PARAGRAPH_SPACING.default),
    paperWidth: normalizePaperWidth(record.paperWidth),
  }
}

type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasOwn(value: unknown, field: keyof WritingPreferences): boolean {
  const record = object(value)
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, field)
}

type LegacyValue = CompletionPreference | string | undefined

function legacyValue(storage: LegacyStorage | undefined, field: keyof WritingPreferences): LegacyValue {
  try {
    const value = storage?.getItem(field === 'completion' ? COMPLETION_PREFERENCE_KEY : AUTHOR_PREFERENCES_KEY)
    if (value === null || value === undefined) return undefined
    if (field === 'completion') return value === 'manual' || value === 'pause' ? value : undefined
    return normalizeAuthorPreferences(value)
  } catch {
    return undefined
  }
}

function removeLegacy(storage: LegacyStorage | undefined, field: keyof WritingPreferences): void {
  storage?.removeItem(field === 'completion' ? COMPLETION_PREFERENCE_KEY : AUTHOR_PREFERENCES_KEY)
}

export type WritingMigrationResult = { failed: (keyof WritingPreferences)[] }

export type WritingMigration = () => Promise<WritingMigrationResult>

/** One client startup migration may be shared by the root and the Writing page. */
export function createWritingMigration(scope: SettingsScope<WritingPreferences>, storage: LegacyStorage | undefined): WritingMigration {
  let inFlight: Promise<WritingMigrationResult> | undefined
  return () => {
    if (!inFlight) inFlight = new Promise<WritingMigrationResult>((resolve) => {
      let dispose = () => {}
      const begin = () => {
        const snapshot = scope.getSnapshot()
        if (snapshot.status === 'loading') return
        dispose()
        if (snapshot.status === 'ready') void migrateLegacyWritingPreferences(scope, storage).then(resolve)
        else resolve({ failed: [] })
      }
      dispose = scope.subscribe(begin)
      begin()
    }).finally(() => { inFlight = undefined })
    return inFlight
  }
}

/** Migrate one legacy browser value only after the Host scope confirms its user-layer write. */
export async function migrateLegacyWritingPreferences(
  scope: SettingsScope<WritingPreferences>,
  storage: LegacyStorage | undefined,
): Promise<WritingMigrationResult> {
  const snapshot = scope.getSnapshot()
  if (snapshot.status !== 'ready') return { failed: [] }
  const failed: (keyof WritingPreferences)[] = []
  // authorMemory 没有历史 localStorage 键——只需保证 user 层有值即可,缺则保持默认空串。
  for (const field of ['completion', 'authorPreferences'] as const) {
    if (hasOwn(snapshot.user, field)) {
      try { removeLegacy(storage, field) } catch { failed.push(field) }
      continue
    }
    const value = legacyValue(storage, field)
    if (value === undefined) continue
    try {
      await scope.set(field, value)
      const committed = scope.getSnapshot()
      if (!hasOwn(committed.user, field)) throw new Error(`${field} migration did not commit`)
      removeLegacy(storage, field)
    } catch {
      failed.push(field)
    }
  }
  return { failed }
}

export function decodeWritingPreferences(value: unknown): WritingPreferences | undefined {
  const record = object(value)
  if (!record) return undefined
  if (record.completion !== 'manual' && record.completion !== 'pause') return undefined
  if (typeof record.authorPreferences !== 'string') return undefined
  if (typeof record.authorMemory !== 'string') return undefined
  return {
    completion: record.completion,
    authorPreferences: normalizeAuthorPreferences(record.authorPreferences),
    authorMemory: normalizeAuthorMemory(record.authorMemory),
    ...normalizePaperPreferences(record),
  }
}

export function writingPreferences(snapshot: SettingsScopeSnapshot<WritingPreferences>, storage?: LegacyStorage): WritingPreferences {
  const resolved = snapshot.status === 'ready' && snapshot.value
    ? { ...DEFAULT_WRITING_PREFERENCES, ...snapshot.value, ...normalizePaperPreferences(snapshot.value as unknown as Record<string, unknown>) }
    : DEFAULT_WRITING_PREFERENCES
  if (snapshot.status !== 'ready') return resolved
  const legacyCompletion = legacyValue(storage, 'completion')
  const legacyAuthorPreferences = legacyValue(storage, 'authorPreferences')
  return {
    ...resolved,
    completion: hasOwn(snapshot.user, 'completion') || (legacyCompletion !== 'manual' && legacyCompletion !== 'pause') ? resolved.completion : legacyCompletion,
    authorPreferences: hasOwn(snapshot.user, 'authorPreferences') || typeof legacyAuthorPreferences !== 'string' ? resolved.authorPreferences : legacyAuthorPreferences,
    authorMemory: hasOwn(snapshot.user, 'authorMemory') ? resolved.authorMemory : DEFAULT_WRITING_PREFERENCES.authorMemory,
  }
}

export type WritingSettingsSlots = {
  slots: {
    inject(key: string, callback: () => unknown): unknown
    register(spec: unknown, render: unknown): unknown
  }
}

/*
 * 写作设置页内容。渲染进 shell 自建的设置弹窗（settings.tsx）的"写作"
 * 标签页;上游 DSH 设置弹窗（settings.section slot）在桌面 profile 中已被
 * 禁用,不再注册进去。
 * 作者侧写不对作者暴露设置入口,记忆仍只通过对话里的确认卡写入。
 */
export function WritingSettings({ scope, migrate, progressScope }: {
  scope: SettingsScope<WritingPreferences>
  migrate: WritingMigration
  progressScope: WritingProgressScope
}) {
  useLocale()
  const snapshot = useSyncExternalStore(
    scope.subscribe.bind(scope),
    scope.getSnapshot.bind(scope),
    scope.getSnapshot.bind(scope),
  )
  const values = writingPreferences(snapshot, globalThis.localStorage)
  const migrated = useRef(false)
  const [migrationFailure, setMigrationFailure] = useState<(keyof WritingPreferences)[]>([])
  const [saving, setSaving] = useState<keyof WritingPreferences | null>(null)
  const [writeFailure, setWriteFailure] = useState('')
  const [authorDraft, setAuthorDraft] = useState(values.authorPreferences)

  const runMigration = async () => {
    const result = await migrate()
    setMigrationFailure(result.failed)
  }

  useEffect(() => {
    if (snapshot.status !== 'ready' || migrated.current) return
    migrated.current = true
    void runMigration()
  }, [snapshot.status])

  useEffect(() => {
    setAuthorDraft(values.authorPreferences)
  }, [values.authorPreferences])

  const update = async <K extends keyof WritingPreferences>(field: K, value: WritingPreferences[K]) => {
    const paperField = field !== 'completion' && field !== 'authorPreferences' && field !== 'authorMemory'
    if (!paperField) setSaving(field)
    setWriteFailure('')
    try {
      const normalized = field === 'authorPreferences'
        ? normalizeAuthorPreferences(value as string)
        : field === 'fontSize'
          ? clampNumber(value, PAPER_FONT_SIZE.min, PAPER_FONT_SIZE.max, PAPER_FONT_SIZE.default)
          : field === 'lineHeight'
            ? clampNumber(value, PAPER_LINE_HEIGHT.min, PAPER_LINE_HEIGHT.max, PAPER_LINE_HEIGHT.default)
            : field === 'paragraphSpacing'
              ? clampNumber(value, PAPER_PARAGRAPH_SPACING.min, PAPER_PARAGRAPH_SPACING.max, PAPER_PARAGRAPH_SPACING.default)
              : field === 'fontFamily'
                ? normalizePaperFontFamily(value)
                : field === 'paperWidth'
                  ? normalizePaperWidth(value)
                  : value
      await scope.set(field, normalized as WritingPreferences[K])
      if (!hasOwn(scope.getSnapshot().user, field)) throw new Error('write did not commit')
    } catch {
      const failure = field === 'completion'
        ? t('writing.completionFailed')
        : field === 'authorPreferences'
          ? t('writing.authorFailed')
          : t('writing.paperFailed')
      setWriteFailure(failure)
    } finally {
      if (!paperField) setSaving(null)
    }
  }

  if (snapshot.status === 'loading') return e('section', { className: 'writing-settings', 'aria-labelledby': 'writing-settings-title' },
    e('h2', { id: 'writing-settings-title' }, t('settings.writing')),
    e('p', { role: 'status' }, t('writing.loading')),
  )

  if (snapshot.status === 'unavailable') return e('section', { className: 'writing-settings', 'aria-labelledby': 'writing-settings-title' },
    e('h2', { id: 'writing-settings-title' }, t('settings.writing')),
    e('p', { role: 'alert' }, t('writing.unavailable')),
  )

  return e('section', { className: 'writing-settings', 'aria-labelledby': 'writing-settings-title' },
    e('h2', { id: 'writing-settings-title' }, t('settings.writing')),
    e(WritingProgressSettings, { scope: progressScope }),
    e('fieldset', { disabled: saving !== null },
      e('legend', null, t('writing.completion')),
      e('p', null, t('writing.completionHint')),
      ([['manual', t('writing.manualOnly')], ['pause', t('writing.pauseHint')]] as const).map(([value, label]) => e('label', { key: value },
        e('input', {
          type: 'radio',
          name: 'completion-preference',
          checked: values.completion === value,
          onChange: () => void update('completion', value),
        }),
        label,
      )),
    ),
    e('fieldset', { className: 'paper-typography' },
      e('legend', null, t('writing.paper')),
      e('p', null, t('writing.paperHint')),
      e('label', null,
        e('input', {
          type: 'checkbox',
          checked: values.typewriter,
          onChange: () => void update('typewriter', !values.typewriter),
        }),
        t('writing.typewriter'),
        e('kbd', null, 'Ctrl+Alt+T'),
      ),
      e('label', null,
        e('input', {
          type: 'checkbox',
          checked: values.focusParagraph,
          onChange: () => void update('focusParagraph', !values.focusParagraph),
        }),
        t('writing.focusParagraph'),
        e('kbd', null, 'Ctrl+Alt+P'),
      ),
      e('label', { className: 'slider-row' },
        e('span', null, t('writing.fontSize', { size: values.fontSize })),
        e('input', {
          type: 'range',
          min: PAPER_FONT_SIZE.min,
          max: PAPER_FONT_SIZE.max,
          step: 1,
          value: values.fontSize,
          'aria-label': t('writing.fontSizeAria'),
          onChange: (event: ChangeEvent<HTMLInputElement>) => void update('fontSize', Number(event.target.value)),
        }),
      ),
      e('label', { className: 'slider-row' },
        e('span', null, t('writing.lineHeight', { value: values.lineHeight.toFixed(1) })),
        e('input', {
          type: 'range',
          min: PAPER_LINE_HEIGHT.min,
          max: PAPER_LINE_HEIGHT.max,
          step: 0.1,
          value: values.lineHeight,
          'aria-label': t('writing.lineHeightAria'),
          onChange: (event: ChangeEvent<HTMLInputElement>) => void update('lineHeight', Number(event.target.value)),
        }),
      ),
      e('label', { className: 'slider-row' },
        e('span', null, t('writing.paragraphSpacing', { value: values.paragraphSpacing.toFixed(2) })),
        e('input', {
          type: 'range',
          min: PAPER_PARAGRAPH_SPACING.min,
          max: PAPER_PARAGRAPH_SPACING.max,
          step: 0.05,
          value: values.paragraphSpacing,
          'aria-label': t('writing.paragraphSpacingAria'),
          onChange: (event: ChangeEvent<HTMLInputElement>) => void update('paragraphSpacing', Number(event.target.value)),
        }),
      ),
      e('div', { className: 'choice-row', role: 'group', 'aria-label': t('writing.font') },
        e('span', null, t('writing.font')),
        ([['serif', t('writing.serif')], ['sans', t('writing.sans')], ['mono', t('writing.mono')]] as const).map(([value, label]) => e('label', { key: value },
          e('input', {
            type: 'radio',
            name: 'paper-font-family',
            checked: values.fontFamily === value,
            onChange: () => void update('fontFamily', value),
          }),
          label,
        )),
      ),
      e('div', { className: 'choice-row', role: 'group', 'aria-label': t('writing.paperWidth') },
        e('span', null, t('writing.paperWidth')),
        ([['narrow', t('writing.narrow')], ['medium', t('writing.medium')], ['wide', t('writing.wide')]] as const).map(([value, label]) => e('label', { key: value },
          e('input', {
            type: 'radio',
            name: 'paper-width',
            checked: values.paperWidth === value,
            onChange: () => void update('paperWidth', value),
          }),
          label,
        )),
      ),
    ),
    e('label', { className: 'author-preferences' },
      e('span', null, t('writing.authorPref')),
      e('textarea', {
        value: authorDraft,
        maxLength: AUTHOR_PREFERENCES_MAX_CHARS,
        rows: 5,
        placeholder: t('writing.authorPlaceholder'),
        'aria-label': t('writing.authorPref'),
        disabled: saving !== null,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setAuthorDraft(event.target.value),
      }),
      e('small', null, t('writing.authorCount', { count: authorDraft.length, max: AUTHOR_PREFERENCES_MAX_CHARS })),
    ),
    e('button', { type: 'button', disabled: saving !== null || authorDraft === values.authorPreferences, onClick: () => void update('authorPreferences', authorDraft) }, saving === 'authorPreferences' ? t('common.saving') : t('writing.saveAuthor')),
    writeFailure ? e('p', { role: 'alert' }, writeFailure) : null,
    migrationFailure.length ? e('p', { role: 'alert' },
      t('writing.migrationPending'),
      e('button', { type: 'button', onClick: () => void runMigration(), disabled: saving !== null }, t('writing.retryMigration')),
    ) : null,
  )
}
