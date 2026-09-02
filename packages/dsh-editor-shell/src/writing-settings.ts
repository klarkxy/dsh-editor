import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement as e, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import { AUTHOR_PREFERENCES_KEY, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorPreferences } from './author-preferences.ts'
import { COMPLETION_PREFERENCE_KEY, type CompletionPreference } from './completion-preference.ts'
import { WRITING_SETTINGS_NAMESPACE, type WritingPreferences } from './writing-settings-contract.ts'

export { WRITING_SETTINGS_NAMESPACE, type WritingPreferences } from './writing-settings-contract.ts'

export const DEFAULT_WRITING_PREFERENCES: WritingPreferences = {
  completion: 'manual',
  authorPreferences: '',
}

type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasOwn(value: unknown, field: keyof WritingPreferences): boolean {
  const record = object(value)
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, field)
}

function legacyValue(storage: LegacyStorage | undefined, field: keyof WritingPreferences): CompletionPreference | string | undefined {
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
  return {
    completion: record.completion,
    authorPreferences: normalizeAuthorPreferences(record.authorPreferences),
  }
}

export function writingPreferences(snapshot: SettingsScopeSnapshot<WritingPreferences>, storage?: LegacyStorage): WritingPreferences {
  const resolved = snapshot.status === 'ready' && snapshot.value ? snapshot.value : DEFAULT_WRITING_PREFERENCES
  if (snapshot.status !== 'ready') return resolved
  const legacyCompletion = legacyValue(storage, 'completion')
  const legacyAuthorPreferences = legacyValue(storage, 'authorPreferences')
  return {
    completion: hasOwn(snapshot.user, 'completion') || (legacyCompletion !== 'manual' && legacyCompletion !== 'pause') ? resolved.completion : legacyCompletion,
    authorPreferences: hasOwn(snapshot.user, 'authorPreferences') || typeof legacyAuthorPreferences !== 'string' ? resolved.authorPreferences : legacyAuthorPreferences,
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
 */
export function WritingSettings({ scope, migrate }: { scope: SettingsScope<WritingPreferences>; migrate: WritingMigration }) {
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

  const update = async (field: keyof WritingPreferences, value: CompletionPreference | string) => {
    setSaving(field)
    setWriteFailure('')
    try {
      await scope.set(field, field === 'authorPreferences' ? normalizeAuthorPreferences(value) : value)
      if (!hasOwn(scope.getSnapshot().user, field)) throw new Error('write did not commit')
    } catch {
      setWriteFailure(field === 'completion' ? '自动补全偏好未能保存，请重试。' : '作者约定未能保存，请重试。')
    } finally {
      setSaving(null)
    }
  }

  if (snapshot.status === 'loading') return e('section', { className: 'writing-settings', 'aria-labelledby': 'writing-settings-title' },
    e('h2', { id: 'writing-settings-title' }, '写作'),
    e('p', { role: 'status' }, '正在读取写作偏好…'),
  )

  if (snapshot.status === 'unavailable') return e('section', { className: 'writing-settings', 'aria-labelledby': 'writing-settings-title' },
    e('h2', { id: 'writing-settings-title' }, '写作'),
    e('p', { role: 'alert' }, '写作偏好当前不可用，尚未保存任何更改。'),
  )

  return e('section', { className: 'writing-settings', 'aria-labelledby': 'writing-settings-title' },
    e('h2', { id: 'writing-settings-title' }, '写作'),
    e('fieldset', { disabled: saving !== null },
      e('legend', null, '自动补全'),
      e('p', null, '补全只生成建议，经你确认后才会写入正文。'),
      ([['manual', '仅手动'], ['pause', '停顿后提示']] as const).map(([value, label]) => e('label', { key: value },
        e('input', {
          type: 'radio',
          name: 'completion-preference',
          checked: values.completion === value,
          onChange: () => void update('completion', value),
        }),
        label,
      )),
    ),
    e('label', { className: 'author-preferences' },
      e('span', null, '跨作品作者约定'),
      e('textarea', {
        value: authorDraft,
        maxLength: AUTHOR_PREFERENCES_MAX_CHARS,
        rows: 5,
        placeholder: '例如：第三人称限知；少用感叹号；对白保持克制。',
        'aria-label': '跨作品作者约定',
        disabled: saving !== null,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setAuthorDraft(event.target.value),
      }),
      e('small', null, `${authorDraft.length} / ${AUTHOR_PREFERENCES_MAX_CHARS} 字；会用于所有作品的搭档、补全和选段修改。`),
    ),
    e('button', { type: 'button', disabled: saving !== null || authorDraft === values.authorPreferences, onClick: () => void update('authorPreferences', authorDraft) }, saving === 'authorPreferences' ? '保存中…' : '保存作者约定'),
    writeFailure ? e('p', { role: 'alert' }, writeFailure) : null,
    migrationFailure.length ? e('p', { role: 'alert' },
      '旧版本机偏好尚未迁移；原值已保留。',
      e('button', { type: 'button', onClick: () => void runMigration(), disabled: saving !== null }, '重试迁移'),
    ) : null,
  )
}
