import type { SettingsScope, SettingsScopeSnapshot } from './dsh-compat.ts'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import { Button, Callout, Card, Flex, Heading, Kbd, RadioGroup, Slider, Switch, Text, TextArea } from '@radix-ui/themes'
import { AUTHOR_PREFERENCES_KEY, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { COMPLETION_PREFERENCE_KEY, type CompletionPreference } from './completion-preference.ts'
import { WRITING_SETTINGS_NAMESPACE, type PaperFontFamily, type PaperWidth, type WritingModelRoute, type WritingPreferences } from './writing-settings-contract.ts'
import { t, useLocale } from './i18n/index.ts'
import { ActivityDots } from './client/ui/index.ts'
import { Select } from './client/select.tsx'


export { WRITING_SETTINGS_NAMESPACE, type PaperFontFamily, type PaperWidth, type WritingModelRoute, type WritingPreferences } from './writing-settings-contract.ts'

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

const WRITING_EFFORTS = new Set(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

/** Host `off` and public `none` are the same none-thinking slot. */
export function normalizeWritingEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  if (id === 'none') return 'off'
  return WRITING_EFFORTS.has(id) ? id : undefined
}

/** Empty provider+model means the documented fallback (current chat / runtime default). */
export function normalizeWritingModelRoute(value: unknown): WritingModelRoute | undefined {
  const record = object(value)
  if (!record) return undefined
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined
  const provider = record.provider.trim()
  const model = record.model.trim()
  if (!provider && !model) return undefined
  const reasoningEffort = normalizeWritingEffort(record.reasoningEffort)
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model }
}

export function writingModelRouteValue(route: WritingModelRoute | undefined): WritingModelRoute {
  return route ?? { provider: '', model: '' }
}

function normalizeModelPreferences(record: Record<string, unknown>): Pick<WritingPreferences, 'completionModel' | 'rewriteModel' | 'chatModel'> {
  return {
    completionModel: normalizeWritingModelRoute(record.completionModel),
    rewriteModel: normalizeWritingModelRoute(record.rewriteModel),
    chatModel: normalizeWritingModelRoute(record.chatModel),
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
    ...normalizeModelPreferences(record),
  }
}

export function writingPreferences(snapshot: SettingsScopeSnapshot<WritingPreferences>, storage?: LegacyStorage): WritingPreferences {
  const resolved = snapshot.status === 'ready' && snapshot.value
    ? {
      ...DEFAULT_WRITING_PREFERENCES,
      ...snapshot.value,
      ...normalizePaperPreferences(snapshot.value as unknown as Record<string, unknown>),
      ...normalizeModelPreferences(snapshot.value as unknown as Record<string, unknown>),
    }
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
function LabeledSlider(props: {
  label: string
  valueLabel: string
  value: number
  min: number
  max: number
  step: number
  onValueChange(value: number): void
}) {
  const root = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const thumb = root.current?.querySelector<HTMLElement>('[role="slider"]')
    if (thumb) thumb.setAttribute('aria-label', props.label)
  }, [props.label, props.value])
  return (
    <Flex className="slider-row" direction="column" gap="1">
      <Text as="label" size="2">
        {props.valueLabel}
      </Text>
      <Slider
        ref={root}
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        aria-label={props.label}
        style={{ width: '100%' }}
        onValueChange={(next) => {
          const value = next[0]
          if (value !== undefined) props.onValueChange(value)
        }} />
    </Flex>
  )
}

export function WritingSettings({ scope, migrate }: {
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

  if (snapshot.status === 'loading') return (
    <section className="writing-settings" aria-label={t('settings.writing')}>
      <Text as="p" size="2" role="status">
        <ActivityDots />
        {t('writing.loading')}
      </Text>
    </section>
  );

  if (snapshot.status === 'unavailable') return (
    <section className="writing-settings" aria-label={t('settings.writing')}>
      <Callout.Root color="red" role="alert">
        <Callout.Text>
          {t('writing.unavailable')}
        </Callout.Text>
      </Callout.Root>
    </section>
  );

  return (
    <section className="writing-settings" aria-label={t('settings.writing')}>
      <fieldset className="settings-block" disabled={saving !== null}>
        <legend className="settings-block-title">
          {t('writing.completion')}
        </legend>
        <Card>
          <RadioGroup.Root
            value={values.completion}
            name="completion-preference"
            aria-label={t('writing.completion')}
            onValueChange={(value) => void update('completion', value as WritingPreferences['completion'])}>
            <Flex direction="column" gap="2">
              <RadioGroup.Item value="manual">{t('writing.manualOnly')}</RadioGroup.Item>
              <RadioGroup.Item value="pause">{t('writing.pauseHint')}</RadioGroup.Item>
            </Flex>
          </RadioGroup.Root>
        </Card>
      </fieldset>
      <fieldset className="paper-typography settings-block">
        <legend className="settings-block-title">
          {t('writing.paper')}
        </legend>
        <Card>
          <Flex direction="column" gap="3">
          <Flex className="paper-experience-toggles" direction="column" gap="3">
            <Flex align="center" justify="between" gap="3">
              <Text size="2">
                {t('writing.typewriter')}
              </Text>
              <Flex align="center" gap="2">
                <Kbd>
                  Ctrl+Alt+T
                </Kbd>
                <Switch
                  checked={values.typewriter}
                  aria-label={t('writing.typewriter')}
                  onCheckedChange={(next) => void update('typewriter', next)} />
              </Flex>
            </Flex>
            <Flex align="center" justify="between" gap="3">
              <Text size="2">
                {t('writing.focusParagraph')}
              </Text>
              <Flex align="center" gap="2">
                <Kbd>
                  Ctrl+Alt+P
                </Kbd>
                <Switch
                  checked={values.focusParagraph}
                  aria-label={t('writing.focusParagraph')}
                  onCheckedChange={(next) => void update('focusParagraph', next)} />
              </Flex>
            </Flex>
          </Flex>
          <LabeledSlider
            label={t('writing.fontSizeAria')}
            valueLabel={t('writing.fontSize', { size: values.fontSize })}
            value={values.fontSize}
            min={PAPER_FONT_SIZE.min}
            max={PAPER_FONT_SIZE.max}
            step={1}
            onValueChange={(value) => void update('fontSize', value)} />
          <LabeledSlider
            label={t('writing.lineHeightAria')}
            valueLabel={t('writing.lineHeight', { value: values.lineHeight.toFixed(1) })}
            value={values.lineHeight}
            min={PAPER_LINE_HEIGHT.min}
            max={PAPER_LINE_HEIGHT.max}
            step={0.1}
            onValueChange={(value) => void update('lineHeight', value)} />
          <LabeledSlider
            label={t('writing.paragraphSpacingAria')}
            valueLabel={t('writing.paragraphSpacing', { value: values.paragraphSpacing.toFixed(2) })}
            value={values.paragraphSpacing}
            min={PAPER_PARAGRAPH_SPACING.min}
            max={PAPER_PARAGRAPH_SPACING.max}
            step={0.05}
            onValueChange={(value) => void update('paragraphSpacing', value)} />
          <Flex className="choice-row" role="group" aria-label={t('writing.font')} align="center" gap="2" wrap="wrap">
            <Text as="span" size="2" weight="medium">
              {t('writing.font')}
            </Text>
            <Select
              value={values.fontFamily}
              options={[{ value: 'serif', label: t('writing.serif') }, { value: 'sans', label: t('writing.sans') }, { value: 'mono', label: t('writing.mono') }]}
              onChange={(value) => void update('fontFamily', value as PaperFontFamily)}
              aria-label={t('writing.font')} />
          </Flex>
          <Flex className="choice-row" role="group" aria-label={t('writing.paperWidth')} align="center" gap="2" wrap="wrap">
            <Text as="span" size="2" weight="medium">
              {t('writing.paperWidth')}
            </Text>
            <Select
              value={values.paperWidth}
              options={[{ value: 'narrow', label: t('writing.narrow') }, { value: 'medium', label: t('writing.medium') }, { value: 'wide', label: t('writing.wide') }]}
              onChange={(value) => void update('paperWidth', value as PaperWidth)}
              aria-label={t('writing.paperWidth')} />
          </Flex>
          </Flex>
        </Card>
      </fieldset>
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
            disabled={saving !== null}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setAuthorDraft(event.target.value)} />
          <Text size="1" color="gray">
            {t('writing.authorCount', { count: authorDraft.length, max: AUTHOR_PREFERENCES_MAX_CHARS })}
          </Text>
        </Flex>
        <Button
          type="button"
          variant="solid"
          mt="3"
          disabled={saving !== null || authorDraft === values.authorPreferences}
          onClick={() => void update('authorPreferences', authorDraft)}>
          {saving === 'authorPreferences' ? <Fragment>
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
          disabled={saving !== null}>
          {t('writing.retryMigration')}
        </Button>
      </Callout.Root> : null}
    </section>
  );
}
