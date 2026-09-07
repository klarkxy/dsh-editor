import { createElement as e, useEffect, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  MAX_GOAL_CHARS,
  writingProgressFor,
  type WritingProgress,
  type WritingProgressScope,
} from './writing-progress.ts'
import { t, useLocale } from './i18n/index.ts'

/*
 * 每日字数目标(goalChars) 的设置入口,渲染进 "写作" 标签页。
 * 基线(baselines) 不暴露给用户编辑,只在 root 拿到 overview 时静默写入。
 */
export function WritingProgressSettings({ scope }: { scope: WritingProgressScope }) {
  useLocale()
  const snapshot = useSyncExternalStore(
    scope.subscribe.bind(scope),
    scope.getSnapshot.bind(scope),
    scope.getSnapshot.bind(scope),
  )
  const progress: WritingProgress = writingProgressFor(snapshot)
  const writable = snapshot.status === 'ready' && snapshot.writable !== false
  const [goalDraft, setGoalDraft] = useState(String(progress.goalChars || ''))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    setGoalDraft(String(progress.goalChars || ''))
  }, [progress.goalChars])

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.target.value.replace(/[^\d]/g, '').slice(0, String(MAX_GOAL_CHARS).length)
    setGoalDraft(digitsOnly)
  }

  const commit = async () => {
    if (saving) return
    const numeric = goalDraft.trim() === '' ? 0 : Number.parseInt(goalDraft, 10)
    if (Number.isNaN(numeric) || numeric < 0) { setFailure(t('progress.invalidGoal')); return }
    const next = Math.min(MAX_GOAL_CHARS, numeric)
    if (next === progress.goalChars) return
    setSaving(true)
    setFailure('')
    try {
      await scope.set('goalChars', next)
    } catch {
      setFailure(t('progress.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (snapshot.status === 'loading') return e('fieldset', { className: 'writing-progress-settings', disabled: true },
    e('legend', null, t('progress.dailyGoal')),
    e('p', { role: 'status' }, t('progress.loading')),
  )

  if (snapshot.status === 'unavailable') return e('fieldset', { className: 'writing-progress-settings', disabled: true },
    e('legend', null, t('progress.dailyGoal')),
    e('p', { role: 'alert' }, t('progress.unavailable')),
  )

  return e('fieldset', { className: 'writing-progress-settings', disabled: !writable || saving },
    e('legend', null, t('progress.dailyGoal')),
    e('label', { className: 'goal-input' },
      e('span', null, t('progress.goalChars')),
      e('input', {
        type: 'text',
        inputMode: 'numeric',
        pattern: '\\d*',
        value: goalDraft,
        maxLength: 7,
        placeholder: t('progress.placeholder'),
        'aria-label': t('progress.goalChars'),
        disabled: !writable || saving,
        onChange,
        onBlur: () => void commit(),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); void commit() } },
      }),
      e('small', null, progress.goalChars > 0 ? t('progress.hintSet') : t('progress.hintUnset')),
    ),
    failure ? e('p', { role: 'alert' }, failure) : null,
  )
}
