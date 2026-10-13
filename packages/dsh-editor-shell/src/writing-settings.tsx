import type { SettingsScope, SettingsScopeSnapshot } from './dsh-compat.ts'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Button, Callout, Card, Flex, Heading, Kbd, Separator, Text } from '@radix-ui/themes'
import { AUTHOR_PREFERENCES_KEY, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { COMPLETION_PREFERENCE_KEY, type CompletionPreference } from './completion-preference.ts'
import { COMPLETION_DELAY, normalizeWritingEffort, normalizeWritingModelRoute, object, WRITING_SETTINGS_NAMESPACE, type PaperFontFamily, type PaperWidth, type WritingModelRoute, type WritingPreferences } from './writing-settings-contract.ts'
import { normalizeTypography, typographyCssVariables } from 'dsh-manuscript/client/editor-core'
import { t, useLocale } from './i18n/index.ts'
import { ActivityDots } from './client/ui/index.ts'
import { RadioGroup, SegmentedControl, Slider, Switch } from './ui/index.ts'
import { Select } from './client/select.tsx'
import type { CSSProperties } from 'react'
import { runtimeShortcutHint } from './palette-shortcut.ts'


export { WRITING_SETTINGS_NAMESPACE, normalizeWritingEffort, normalizeWritingModelRoute, writingModelRouteValue, type PaperFontFamily, type PaperWidth, type WritingModelRoute, type WritingPreferences } from './writing-settings-contract.ts'

export const PAPER_FONT_SIZE = { min: 14, max: 28, default: 17 } as const
export const PAPER_LINE_HEIGHT = { min: 1.4, max: 2.4, default: 1.9 } as const
export const PAPER_PARAGRAPH_SPACING = { min: 0, max: 1.5, default: 0.25 } as const
export const PAPER_WIDTH_CH = { narrow: 60, medium: 76 } as const

export const DEFAULT_WRITING_PREFERENCES: WritingPreferences = {
  completion: 'manual',
  completionDelayMs: COMPLETION_DELAY.default,
  writingModelsImported: false,
  authorPreferences: '',
  authorMemory: '',
  typewriter: false,
  focusParagraph: false,
  fontSize: PAPER_FONT_SIZE.default,
  lineHeight: PAPER_LINE_HEIGHT.default,
  fontFamily: 'sans',
  paragraphSpacing: PAPER_PARAGRAPH_SPACING.default,
  paperWidth: 'medium',
  firstLineIndent: false,
  centerSectionMarks: true,
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizePaperFontFamily(value: unknown): PaperFontFamily {
  return value === 'sans' || value === 'mono' || value === 'serif' ? value : 'sans'
}

export function normalizePaperWidth(value: unknown): PaperWidth {
  return value === 'narrow' || value === 'medium' || value === 'wide' ? value : 'medium'
}

export function paperWidthToMaxWidth(width: PaperWidth): number | undefined {
  return width === 'wide' ? undefined : PAPER_WIDTH_CH[width]
}

export function writingTypography(prefs: Pick<WritingPreferences, 'fontSize' | 'lineHeight' | 'fontFamily' | 'paragraphSpacing' | 'paperWidth' | 'firstLineIndent' | 'centerSectionMarks'>) {
  return {
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    fontFamily: prefs.fontFamily,
    paragraphSpacing: prefs.paragraphSpacing,
    maxWidth: paperWidthToMaxWidth(prefs.paperWidth),
    firstLineIndent: prefs.firstLineIndent,
    centerSectionMarks: prefs.centerSectionMarks,
  }
}

function normalizePaperPreferences(record: Record<string, unknown>): Pick<WritingPreferences, 'typewriter' | 'focusParagraph' | 'fontSize' | 'lineHeight' | 'fontFamily' | 'paragraphSpacing' | 'paperWidth' | 'firstLineIndent' | 'centerSectionMarks'> {
  return {
    typewriter: record.typewriter === true,
    focusParagraph: record.focusParagraph === true,
    fontSize: clampNumber(record.fontSize, PAPER_FONT_SIZE.min, PAPER_FONT_SIZE.max, PAPER_FONT_SIZE.default),
    lineHeight: clampNumber(record.lineHeight, PAPER_LINE_HEIGHT.min, PAPER_LINE_HEIGHT.max, PAPER_LINE_HEIGHT.default),
    fontFamily: normalizePaperFontFamily(record.fontFamily),
    paragraphSpacing: clampNumber(record.paragraphSpacing, PAPER_PARAGRAPH_SPACING.min, PAPER_PARAGRAPH_SPACING.max, PAPER_PARAGRAPH_SPACING.default),
    paperWidth: normalizePaperWidth(record.paperWidth),
    firstLineIndent: record.firstLineIndent === true,
    centerSectionMarks: record.centerSectionMarks !== false,
  }
}

function normalizeModelPreferences(record: Record<string, unknown>): Pick<WritingPreferences, 'completionModel' | 'rewriteModel' | 'chatModel'> {
  return {
    completionModel: normalizeWritingModelRoute(record.completionModel),
    rewriteModel: normalizeWritingModelRoute(record.rewriteModel),
    chatModel: normalizeWritingModelRoute(record.chatModel),
  }
}

type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>

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
      if (await scope.set(field, value) === false) throw new Error('Host refused settings write')
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
    completionDelayMs: clampNumber(record.completionDelayMs, COMPLETION_DELAY.min, COMPLETION_DELAY.max, COMPLETION_DELAY.default),
    writingModelsImported: record.writingModelsImported === true,
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
      completionDelayMs: clampNumber(snapshot.value.completionDelayMs, COMPLETION_DELAY.min, COMPLETION_DELAY.max, COMPLETION_DELAY.default),
      writingModelsImported: snapshot.value.writingModelsImported === true,
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
 * 写作设置页内容。渲染进全页设置（app/settings/settings-page.tsx）的"写作"
 * 分区；右侧预览与编辑器共用同一组 --paper-* 排版变量，不复制第二套排版实现。
 * 作者侧写不对作者暴露设置入口,由助手观察后静默写入,超限时自动淘汰最旧的自动条目。
 */
function SettingRow(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <Flex className="settings-row" align="center" justify="between" gap="4" py="3">
      <Flex direction="column" className="settings-row-text" gap="1" minWidth="0">
        <Text size="2" weight="medium" className="settings-row-title">
          {props.title}
        </Text>
        {props.description ? <Text size="1" color="gray" className="settings-row-description">
          {props.description}
        </Text> : null}
      </Flex>
      {props.children}
    </Flex>
  )
}

/** 预览消费与编辑器相同的 --paper-* 变量:缩进、段距、行高、字号、字族、版心宽。 */
function ManuscriptPreview(props: { preferences: WritingPreferences }) {
  const resolved = normalizeTypography(writingTypography(props.preferences))
  const vars = typographyCssVariables(resolved) as CSSProperties
  return (
    <aside className="dsh-settings-preview" aria-label={t('writing.preview')}>
      <div className="dsh-settings-preview__paper" style={vars} data-testid="writing-preview-paper">
        <p className={resolved.centerSectionMarks
          ? 'dsh-settings-preview__section dsh-settings-preview__section--centered'
          : 'dsh-settings-preview__section'}>
          {t('writing.previewSection')}
        </p>
        <p className="dsh-settings-preview__para">{t('writing.previewPara1')}</p>
        <p className="dsh-settings-preview__para">{t('writing.previewPara2')}</p>
        <p className={resolved.centerSectionMarks
          ? 'dsh-settings-preview__mark dsh-settings-preview__section--centered'
          : 'dsh-settings-preview__mark'}>
          {t('writing.previewMark')}
        </p>
        <p className="dsh-settings-preview__para">{t('writing.previewPara3')}</p>
      </div>
    </aside>
  )
}

export function WritingSettings({ scope, migrate, onOpenShortcuts }: {
  onOpenShortcuts?(): void
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

  const runMigration = async () => {
    const result = await migrate()
    setMigrationFailure(result.failed)
  }

  useEffect(() => {
    if (snapshot.status !== 'ready' || migrated.current) return
    migrated.current = true
    void runMigration()
  }, [snapshot.status])

  const update = async <K extends keyof WritingPreferences>(field: K, value: WritingPreferences[K]) => {
    const paperField = field !== 'completion' && field !== 'completionDelayMs'
    if (!paperField) setSaving(field)
    setWriteFailure('')
    try {
      const normalized = field === 'completionDelayMs'
        ? clampNumber(value, COMPLETION_DELAY.min, COMPLETION_DELAY.max, COMPLETION_DELAY.default)
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
      if (await scope.set(field, normalized as WritingPreferences[K]) === false) throw new Error('Host refused settings write')
      if (!hasOwn(scope.getSnapshot().user, field)) throw new Error('write did not commit')
    } catch {
      setWriteFailure(!paperField ? t('writing.completionFailed') : t('writing.paperFailed'))
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
      <div className="dsh-writing-settings">
        <div className="dsh-writing-settings__controls">
          <Card className="settings-block">
            <header className="settings-block-head">
              <Heading as="h3" size="3" className="settings-block-title">
                {t('writing.completion')}
              </Heading>
            </header>
            <RadioGroup
              value={values.completion}
              name="completion-preference"
              aria-label={t('writing.completion')}
              disabled={saving !== null}
              options={[
                { value: 'manual', label: t('writing.manualOnly') },
                { value: 'pause', label: t('writing.pauseHint') },
              ]}
              onValueChange={(value) => void update('completion', value as WritingPreferences['completion'])} />
            {values.completion === 'pause' ? <SettingRow title={t('writing.completionDelay')}>
              <Select
                value={String(values.completionDelayMs ?? COMPLETION_DELAY.default)}
                options={Array.from(new Set([500, 1000, 1500, 2000, 3000, 5000, values.completionDelayMs ?? COMPLETION_DELAY.default])).sort((a, b) => a - b).map(value => ({ value: String(value), label: t('writing.seconds', { seconds: value / 1000 }) }))}
                disabled={saving !== null}
                onChange={value => void update('completionDelayMs', Number(value))}
                aria-label={t('writing.completionDelay')} />
            </SettingRow> : null}
            {values.completion === 'pause' ? <Text as="p" size="2" color="gray">{t('writing.delayHelp')}</Text> : null}
            <Flex direction="column" align="start" gap="2" mt="3">
              <Text size="2"><Kbd>{runtimeShortcutHint('Mod+Enter')}</Kbd> {t('writing.triggerCompletion')}</Text>
              <Text size="2"><Kbd>Tab</Kbd> {t('writing.acceptCompletion')} · <Kbd>Esc</Kbd> {t('writing.dismissCompletion')}</Text>
              {onOpenShortcuts ? <Button variant="ghost" className="settings-link-button" onClick={onOpenShortcuts}>{t('writing.allShortcuts')}</Button> : null}
            </Flex>
          </Card>
          <Card className="paper-typography settings-block">
            <header className="settings-block-head">
              <Heading as="h3" size="3" className="settings-block-title">
                {t('writing.paper')}
              </Heading>
            </header>
            <Switch
              id="writing-typewriter"
              label={t('writing.typewriter')}
              shortcut={runtimeShortcutHint('Mod+Alt+T')}
              checked={values.typewriter}
              onCheckedChange={(next) => void update('typewriter', next)} />
            <Switch
              id="writing-focus-paragraph"
              label={t('writing.focusParagraph')}
              shortcut={runtimeShortcutHint('Mod+Alt+P')}
              checked={values.focusParagraph}
              onCheckedChange={(next) => void update('focusParagraph', next)} />
            <Separator size="4" />
            <div className="writing-slider-group">
              <Slider
                label={t('writing.fontSizeAria')}
                format={(value) => `${Math.round(value)}px`}
                value={[values.fontSize]}
                min={PAPER_FONT_SIZE.min}
                max={PAPER_FONT_SIZE.max}
                step={1}
                onValueChange={(next) => { if (next[0] !== undefined) void update('fontSize', next[0]) }} />
              <Slider
                label={t('writing.lineHeightAria')}
                format={(value) => value.toFixed(1)}
                value={[values.lineHeight]}
                min={PAPER_LINE_HEIGHT.min}
                max={PAPER_LINE_HEIGHT.max}
                step={0.1}
                onValueChange={(next) => { if (next[0] !== undefined) void update('lineHeight', next[0]) }} />
              <Slider
                label={t('writing.paragraphSpacingAria')}
                format={(value) => `${value.toFixed(2)}em`}
                value={[values.paragraphSpacing]}
                min={PAPER_PARAGRAPH_SPACING.min}
                max={PAPER_PARAGRAPH_SPACING.max}
                step={0.05}
                onValueChange={(next) => { if (next[0] !== undefined) void update('paragraphSpacing', next[0]) }} />
            </div>
            <Separator size="4" />
            <SettingRow title={t('writing.font')}>
              <SegmentedControl
                value={values.fontFamily}
                options={[
                  { value: 'serif', label: t('writing.serif') },
                  { value: 'sans', label: t('writing.sans') },
                  { value: 'mono', label: t('writing.mono') },
                ]}
                onValueChange={(value) => void update('fontFamily', value as PaperFontFamily)}
                aria-label={t('writing.font')} />
            </SettingRow>
            <SettingRow title={t('writing.paperWidth')}>
              <SegmentedControl
                value={values.paperWidth}
                options={[
                  { value: 'narrow', label: t('writing.narrow') },
                  { value: 'medium', label: t('writing.medium') },
                  { value: 'wide', label: t('writing.wide') },
                ]}
                onValueChange={(value) => void update('paperWidth', value as PaperWidth)}
                aria-label={t('writing.paperWidth')} />
            </SettingRow>
            <Separator size="4" />
            <Switch
              id="writing-first-line-indent"
              label={t('writing.firstLineIndent')}
              description={t('writing.firstLineIndentHint')}
              checked={values.firstLineIndent}
              onCheckedChange={(next) => void update('firstLineIndent', next)} />
            <Switch
              id="writing-center-section-marks"
              label={t('writing.centerSectionMarks')}
              description={t('writing.centerSectionMarksHint')}
              checked={values.centerSectionMarks}
              onCheckedChange={(next) => void update('centerSectionMarks', next)} />
          </Card>
        </div>
        <ManuscriptPreview preferences={values} />
      </div>
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
