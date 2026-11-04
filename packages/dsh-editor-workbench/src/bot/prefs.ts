import type { Context } from '@deepseek-ai/cordis'
import { normalizeAuthorPreferences } from '../contracts.ts'
import { promptFingerprint } from './freeze.ts'

type SettingsService = { describe(): Array<{ ns: string; value: unknown }> }

/** Whether the ui-limit-break namespace is on, read through the settings service. */
export function readLimitBreak(ctx: Context): boolean {
  const settings = (ctx as { get?(name: string): unknown }).get?.('settings') as SettingsService | undefined
  const entry = settings?.describe?.().find((item) => item.ns === 'ui-limit-break')
  const value = entry?.value
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).limitBreakMode === true)
}

export function readAuthorPreferences(ctx: Context): string {
  const service = (ctx as { get?(name: string): unknown }).get?.('editorWritingPreferences') as { read?(): unknown } | undefined
  const raw = service?.read?.()
  const prefs = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).authorPreferences : undefined
  return normalizeAuthorPreferences(prefs)
}

/** Fingerprint for the prompt freeze: author preferences + limit-break flag only. */
export function currentPromptFingerprint(ctx: Context): string {
  return promptFingerprint(readAuthorPreferences(ctx), readLimitBreak(ctx))
}
