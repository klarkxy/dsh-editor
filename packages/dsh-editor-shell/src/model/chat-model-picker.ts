import { t, type MessageKey } from '../i18n/index.ts'
import type { ModelsSnapshot } from '../client/settings-models-state.ts'
import { credentialDot, providerIdOf } from '../client/settings-models-store.ts'

/** A missing-key hint requires a fresh, successful native credential description. */
export function currentModelNeedsKey(provider: string, state: ModelsSnapshot): boolean {
  if (state.status !== 'ready' || state.refreshing || state.error !== null || state.credentialError !== null) return false
  return state.rows.some(row => providerIdOf(row.entry) === provider && credentialDot(row) === 'missing')
}

const EFFORT_LABELS: Record<string, MessageKey> = {
  off: 'chat.effortOff',
  none: 'chat.effortOff',
  low: 'chat.effortLow',
  medium: 'chat.effortMedium',
  high: 'chat.effortHigh',
  xhigh: 'chat.effortXHigh',
  max: 'chat.effortMax',
}

/** Host `off` is the none-thinking slot. Labels follow the UI locale. */
export function effortDisplay(id: string, name?: string): string {
  if (!id) return ''
  const key = EFFORT_LABELS[id]
  return key ? t(key) : name || id
}

/** Visible trigger next to the model name: “思考 关”, not the bare “关” or the field name “思考强度”. */
export function effortTriggerLabel(id: string): string {
  const name = effortDisplay(id) || t('chat.effortOff')
  return t('chat.effortTrigger', { name })
}
