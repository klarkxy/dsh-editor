import { createElement as e, useState, type ChangeEvent } from 'react'
import {
  formatWorldbookTriggerLines,
  parseWorldbookTriggerLines,
  worldbookEditorMetadata,
  writeWorldbookFrontmatter,
} from 'dsh-editor-workbench/contracts'
import { t } from '../i18n/index.ts'

export function isWorldbookPath(path: string): boolean {
  return /^世界书\/.+\.md$/i.test(path)
}

export type WorldbookSettingsInput = { triggers: string; enabled: boolean; priority: string }

export type WorldbookApplyResult =
  | { ok: true; text: string; note: string }
  | { ok: false; note: string }

export function applyWorldbookSettings(path: string, text: string, input: WorldbookSettingsInput): WorldbookApplyResult {
  const metadata = worldbookEditorMetadata(path, text)
  const values = parseWorldbookTriggerLines(input.triggers)
  const numericPriority = Number(input.priority)
  if (!metadata.valid) return { ok: false, note: t('worldbook.invalidHeader') }
  if (!values.length) return { ok: false, note: t('worldbook.needTrigger') }
  if (values.length > 16 || values.some((value) => value.length > 64 || /[\u0000-\u001f\u007f]/.test(value))) {
    return { ok: false, note: t('worldbook.triggerLimit') }
  }
  if (!/^-?\d+$/.test(input.priority.trim()) || !Number.isSafeInteger(numericPriority) || numericPriority < -100 || numericPriority > 100) {
    return { ok: false, note: t('worldbook.priorityRange') }
  }
  try {
    return {
      ok: true,
      text: writeWorldbookFrontmatter(text, { triggers: values, enabled: input.enabled, priority: numericPriority }),
      note: t('worldbook.addedDraft'),
    }
  } catch {
    return { ok: false, note: t('worldbook.unclosed') }
  }
}

function WorldbookSettings(props: { path: string; text: string; onChange(text: string): void; onNote(note: string): void }) {
  const metadata = worldbookEditorMetadata(props.path, props.text)
  const [triggers, setTriggers] = useState(formatWorldbookTriggerLines(metadata.triggers))
  const [enabled, setEnabled] = useState(metadata.enabled)
  const [priority, setPriority] = useState(String(metadata.priority))
  const apply = () => {
    const result = applyWorldbookSettings(props.path, props.text, { triggers, enabled, priority })
    props.onNote(result.note)
    if (result.ok) props.onChange(result.text)
  }
  return e('section', { className: 'worldbook-settings', 'aria-label': t('worldbook.title') },
    e('div', null,
      e('strong', null, t('worldbook.triggerSettings')),
      e('small', null, t('worldbook.hint')),
      !metadata.valid ? e('span', { className: 'warning', role: 'alert' }, t('worldbook.invalidNow')) : null,
    ),
    e('label', null, e('span', null, t('worldbook.triggersLabel')), e('textarea', {
      value: triggers,
      disabled: !metadata.valid,
      rows: Math.min(3, Math.max(1, triggers.split(/\r?\n/).length)),
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setTriggers(event.target.value),
      'aria-label': t('worldbook.triggersAria'),
    })),
    e('label', { className: 'worldbook-enabled' }, e('input', {
      type: 'checkbox',
      checked: enabled,
      disabled: !metadata.valid,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setEnabled(event.target.checked),
    }), e('span', null, t('worldbook.enabled'))),
    e('label', null, e('span', null, t('worldbook.priority')), e('input', {
      type: 'number',
      min: -100,
      max: 100,
      step: 1,
      value: priority,
      disabled: !metadata.valid,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setPriority(event.target.value),
      'aria-label': t('worldbook.priorityAria'),
    })),
    e('button', { type: 'button', onClick: apply, disabled: !metadata.valid }, t('worldbook.apply')),
  )
}

export { WorldbookSettings }
