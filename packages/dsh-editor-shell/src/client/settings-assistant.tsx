import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { Button, Callout, Card, Flex, Heading, Text, TextArea } from '@radix-ui/themes'
import type { SettingsScope } from '../dsh-compat.ts'
import { AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorPreferences } from '../author-preferences.ts'
import { writingPreferences, type WritingMigration, type WritingPreferences } from '../writing-settings.tsx'
import { t, useLocale } from '../i18n/index.ts'
import { ActivityDots } from './ui/index.ts'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasOwn(value: unknown, field: keyof WritingPreferences): boolean {
  const record = object(value)
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, field)
}

export function AssistantSettings({ scope, migrate }: {
  scope: SettingsScope<WritingPreferences>
  migrate: WritingMigration
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
  const [saving, setSaving] = useState(false)
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

  const save = async () => {
    setSaving(true)
    setWriteFailure('')
    try {
      const normalized = normalizeAuthorPreferences(authorDraft)
      await scope.set('authorPreferences', normalized)
      if (!hasOwn(scope.getSnapshot().user, 'authorPreferences')) throw new Error('write did not commit')
    } catch {
      setWriteFailure(t('writing.authorFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (snapshot.status === 'loading') return (
    <section className="assistant-settings" aria-label={t('settings.assistant')}>
      <Text as="p" size="2" role="status">
        <ActivityDots />
        {t('writing.loading')}
      </Text>
    </section>
  );

  if (snapshot.status === 'unavailable') return (
    <section className="assistant-settings" aria-label={t('settings.assistant')}>
      <Callout.Root color="red" role="alert">
        <Callout.Text>
          {t('writing.unavailable')}
        </Callout.Text>
      </Callout.Root>
    </section>
  );

  return (
    <section className="assistant-settings" aria-label={t('settings.assistant')}>
      <Card className="settings-block">
        <header className="settings-block-head">
          <Heading as="h3" id="writing-author-pref" size="3" className="settings-block-title">
            {t('writing.authorPref')}
          </Heading>
        </header>
        <Flex className="author-preferences" direction="column" gap="2">
          <TextArea
            value={authorDraft}
            maxLength={AUTHOR_PREFERENCES_MAX_CHARS}
            rows={5}
            placeholder={t('writing.authorPlaceholder')}
            aria-labelledby="writing-author-pref"
            disabled={saving}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setAuthorDraft(event.target.value)} />
          <Text size="1" color="gray">
            {t('writing.authorCount', { count: authorDraft.length, max: AUTHOR_PREFERENCES_MAX_CHARS })}
          </Text>
        </Flex>
        <Button
          type="button"
          variant="solid"
          mt="3"
          disabled={saving || authorDraft === values.authorPreferences}
          onClick={() => void save()}>
          {saving ? <Fragment>
            <ActivityDots />
            {t('common.saving')}
          </Fragment> : t('writing.saveAuthor')}
        </Button>
      </Card>
      {writeFailure ? <Callout.Root color="red" role="alert">
        <Callout.Text>
          {writeFailure}
        </Callout.Text>
      </Callout.Root> : null}
      {migrationFailure.length ? <Callout.Root color="amber" role="alert">
        <Callout.Text>
          {t('writing.migrationPending')}
        </Callout.Text>
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={() => void runMigration()}
          disabled={saving}>
          {t('writing.retryMigration')}
        </Button>
      </Callout.Root> : null}
    </section>
  );
}
