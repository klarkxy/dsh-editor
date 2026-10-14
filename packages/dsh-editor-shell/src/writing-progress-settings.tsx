import {
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Flex, Input, Notice, Text } from './ui/index.ts'
import {
  MAX_GOAL_CHARS,
  writingProgressFor,
  type WritingProgress,
  type WritingProgressScope,
} from './writing-progress.ts'
import { t, useLocale } from './i18n/index.ts'
import { ActivityDots } from './client/ui/index.ts'

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

  const onChange = (value: string) => {
    const digitsOnly = value.replace(/[^\d]/g, '').slice(0, String(MAX_GOAL_CHARS).length)
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

  if (snapshot.status === 'loading') return (
    <fieldset className="writing-progress-settings" disabled={true}>
      <legend>
        {t('progress.dailyGoal')}
      </legend>
      <Text as="p" size="2" role="status">
        <ActivityDots />
        {t('progress.loading')}
      </Text>
    </fieldset>
  );

  if (snapshot.status === 'unavailable') return (
    <fieldset className="writing-progress-settings" disabled={true}>
      <legend>
        {t('progress.dailyGoal')}
      </legend>
      <Notice tone="danger">
        {t('progress.unavailable')}
      </Notice>
    </fieldset>
  );

  return (
    <fieldset className="writing-progress-settings" disabled={!writable || saving}>
      <legend>
        {t('progress.dailyGoal')}
      </legend>
      <Flex className="goal-input" direction="column" gap="2">
        <Text as="span" size="2" weight="medium">
          {t('progress.goalChars')}
        </Text>
        <Input
          type="text"
          inputMode="numeric"
          pattern={'\\d*'}
          value={goalDraft}
          maxLength={7}
          placeholder={t('progress.placeholder')}
          aria-label={t('progress.goalChars')}
          disabled={!writable || saving}
          onChange={onChange}
          onBlur={() => void commit()}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} />
        <Text size="1" color="gray">
          {progress.goalChars > 0 ? t('progress.hintSet') : t('progress.hintUnset')}
          {saving ? <span className="goal-saving" role="status">
            <ActivityDots />
            <span className="sr-only">
              {t('common.saving')}
            </span>
          </span> : null}
        </Text>
      </Flex>
      {failure ? <Notice tone="danger">
        {failure}
      </Notice> : null}
    </fieldset>
  );
}
