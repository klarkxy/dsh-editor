import { useState, type KeyboardEvent } from 'react';
import { Button, Flex, TextArea } from '../ui/index.ts'
import { REWRITE_PRESETS } from 'dsh-manuscript/client/editor-core'
import { t } from '../i18n/index.ts'
import { isImeEvent } from './ui/ime.ts'
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

  return (
    <Flex
      className="rewrite-presets"
      role="group"
      aria-label={t('rewrite.barLabel')}
      align="center"
      gap="1"
      wrap="wrap">
      {REWRITE_PRESETS.map((preset) => <Button
        key={preset.id}
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => props.onRewrite(preset.instruction)}>
        {t(presetLabelKey(preset.id))}
      </Button>)}
      {customOpen
        ? <Flex className="rewrite-presets-custom" align="center" gap="1" wrap="wrap">
        <TextArea
          value={customText}
          maxLength={CUSTOM_INSTRUCTION_MAX}
          minRows={3}
          maxRows={3}
          placeholder={t('rewrite.customPlaceholder')}
          aria-label={t('rewrite.customPlaceholder')}
          autoFocus={true}
          onChange={(value: string) => setCustomText(value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Escape') { event.preventDefault(); setCustomOpen(false); return }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
              event.preventDefault()
              runCustom()
            }
          }} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!normalizeCustomInstruction(customText)}
          onClick={runCustom}>
          {t('rewrite.customRun')}
        </Button>
      </Flex>
        : <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          setCustomText(lastCustom)
          setCustomOpen(true)
        }}>
        {t('rewrite.custom')}
      </Button>}
    </Flex>
  );
}
