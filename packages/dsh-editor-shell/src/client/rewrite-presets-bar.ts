import { createElement as e, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { REWRITE_PRESETS } from 'dsh-manuscript/client/editor-core'
import { t } from '../i18n/index.ts'
import {
  CUSTOM_INSTRUCTION_MAX,
  normalizeCustomInstruction,
  presetLabelKey,
} from '../rewrite-presets-view.ts'

export function RewritePresetsBar(props: { onRewrite(instruction: string): void }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const [lastCustom, setLastCustom] = useState('')

  const runCustom = () => {
    const instruction = normalizeCustomInstruction(customText)
    if (!instruction) return
    setLastCustom(instruction)
    setCustomText(instruction)
    setCustomOpen(false)
    props.onRewrite(instruction)
  }

  return e('div', { className: 'rewrite-presets', role: 'group', 'aria-label': t('rewrite.barLabel') },
    ...REWRITE_PRESETS.map((preset) => e('button', {
      key: preset.id,
      type: 'button',
      onClick: () => props.onRewrite(preset.instruction),
    }, t(presetLabelKey(preset.id)))),
    customOpen
      ? e('span', { className: 'rewrite-presets-custom' },
        e('input', {
          type: 'text',
          value: customText,
          maxLength: CUSTOM_INSTRUCTION_MAX,
          placeholder: t('rewrite.customPlaceholder'),
          'aria-label': t('rewrite.customPlaceholder'),
          autoFocus: true,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setCustomText(event.target.value),
          onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') { event.preventDefault(); runCustom(); return }
            if (event.key === 'Escape') { event.preventDefault(); setCustomOpen(false) }
          },
        }),
        e('button', {
          type: 'button',
          disabled: !normalizeCustomInstruction(customText),
          onClick: runCustom,
        }, t('rewrite.customRun')),
      )
      : e('button', {
        type: 'button',
        onClick: () => {
          setCustomText(lastCustom)
          setCustomOpen(true)
        },
      }, t('rewrite.custom')),
  )
}
