import { Fragment, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button, Callout, Card, Flex, Heading, Text, TextArea } from '@radix-ui/themes'
import type { SettingsScopeSnapshot } from '../dsh-compat.ts'
import { AUTHOR_PREFERENCES_MAX_CHARS } from '../author-preferences.ts'
import type { WritingMigration, WritingPreferences } from '../writing-settings.tsx'
import { t, useLocale } from '../i18n/index.ts'
import { ActivityDots } from './ui/index.ts'
import { type AuthorDraft } from '../model/settings-assistant.ts'

export function AssistantSettings({ snapshot, migrate, authorDraft, saving, writeFailure, onAuthorDraftChange, onUseLatest, onKeepDraft, onSave }: {
  snapshot: SettingsScopeSnapshot<WritingPreferences>
  migrate: WritingMigration
  authorDraft: AuthorDraft
  saving: boolean
  writeFailure: string
  onAuthorDraftChange(value: string): void
  onUseLatest(): void
  onKeepDraft(): void
  onSave(): void
}) {
  useLocale()
  const migrated = useRef(false)
  const [migrationFailure, setMigrationFailure] = useState<(keyof WritingPreferences)[]>([])

  const runMigration = async () => {
    const result = await migrate()
    setMigrationFailure(result.failed)
  }

  useEffect(() => {
    if (snapshot.status !== 'ready' || migrated.current) return
    migrated.current = true
    void runMigration()
  }, [snapshot.status])

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
            value={authorDraft.value}
            maxLength={AUTHOR_PREFERENCES_MAX_CHARS}
            rows={5}
            placeholder={t('writing.authorPlaceholder')}
            aria-labelledby="writing-author-pref"
            disabled={saving}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onAuthorDraftChange(event.target.value)} />
          <Text size="1" color="gray">
            {t('writing.authorCount', { count: authorDraft.value.length, max: AUTHOR_PREFERENCES_MAX_CHARS })}
          </Text>
          {authorDraft.value !== authorDraft.saved ? <Text size="1" color="gray" role="status">
            {t('writing.authorUnsaved')}
          </Text> : null}
        </Flex>
        {authorDraft.conflicted ? <Callout.Root color="amber" role="alert" mt="3">
          <Callout.Text>{t('writing.authorConflict')}</Callout.Text>
          <Flex gap="2" wrap="wrap" mt="2">
            <Button type="button" variant="soft" color="gray" disabled={saving} onClick={onUseLatest}>{t('writing.authorUseLatest')}</Button>
            <Button type="button" variant="soft" color="gray" disabled={saving} onClick={onKeepDraft}>{t('writing.authorKeepDraft')}</Button>
          </Flex>
        </Callout.Root> : null}
        <Button
          type="button"
          variant="solid"
          mt="3"
          disabled={saving || authorDraft.conflicted || authorDraft.value === authorDraft.saved}
          onClick={onSave}>
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
