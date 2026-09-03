import { createElement as e, useEffect, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  MAX_GOAL_CHARS,
  writingProgressFor,
  type WritingProgress,
  type WritingProgressScope,
} from './writing-progress.ts'

/*
 * 每日字数目标(goalChars) 的设置入口,渲染进 "写作" 标签页。
 * 基线(baselines) 不暴露给用户编辑,只在 root 拿到 overview 时静默写入。
 */
export function WritingProgressSettings({ scope }: { scope: WritingProgressScope }) {
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
    if (Number.isNaN(numeric) || numeric < 0) { setFailure('每日目标只能是 0 或正整数。'); return }
    const next = Math.min(MAX_GOAL_CHARS, numeric)
    if (next === progress.goalChars) return
    setSaving(true)
    setFailure('')
    try {
      await scope.set('goalChars', next)
    } catch {
      setFailure('每日目标未能保存，请重试。')
    } finally {
      setSaving(false)
    }
  }

  if (snapshot.status === 'loading') return e('fieldset', { className: 'writing-progress-settings', disabled: true },
    e('legend', null, '每日目标'),
    e('p', { role: 'status' }, '正在读取每日目标…'),
  )

  if (snapshot.status === 'unavailable') return e('fieldset', { className: 'writing-progress-settings', disabled: true },
    e('legend', null, '每日目标'),
    e('p', { role: 'alert' }, '每日目标当前不可用，尚未保存。'),
  )

  return e('fieldset', { className: 'writing-progress-settings', disabled: !writable || saving },
    e('legend', null, '每日目标'),
    e('label', { className: 'goal-input' },
      e('span', null, '每日目标字数'),
      e('input', {
        type: 'text',
        inputMode: 'numeric',
        pattern: '\\d*',
        value: goalDraft,
        maxLength: 7,
        placeholder: '0 = 未设置',
        'aria-label': '每日目标字数',
        disabled: !writable || saving,
        onChange,
        onBlur: () => void commit(),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); void commit() } },
      }),
      e('small', null, progress.goalChars > 0 ? '保存后会在稿纸头部显示"今日 +N / 目标 M"。' : '留空或填 0 表示不设目标；仍会显示今日写了多少字。'),
    ),
    failure ? e('p', { role: 'alert' }, failure) : null,
  )
}
