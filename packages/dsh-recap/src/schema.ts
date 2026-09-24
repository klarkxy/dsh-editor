import type { RecapSettings } from './contracts.ts'
import { defaultSettings } from './contracts.ts'

export function parseSettingsPatch(value: unknown): Omit<RecapSettings, 'revision'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !['cardsEnabled', 'checkpointsEnabled', 'semanticCheckpointsEnabled', 'idleReturnMs'].includes(key))) return undefined
  if (typeof row.cardsEnabled !== 'boolean' || typeof row.checkpointsEnabled !== 'boolean' || typeof row.semanticCheckpointsEnabled !== 'boolean') return undefined
  if (typeof row.idleReturnMs !== 'number' || !Number.isInteger(row.idleReturnMs) || row.idleReturnMs < 60_000 || row.idleReturnMs > 180 * 60_000) return undefined
  return {
    cardsEnabled: row.cardsEnabled,
    checkpointsEnabled: row.checkpointsEnabled,
    semanticCheckpointsEnabled: row.semanticCheckpointsEnabled,
    idleReturnMs: row.idleReturnMs,
  }
}

export function parseUpdate(payload: unknown): { expectedRevision: number; settings: Omit<RecapSettings, 'revision'> } | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const row = payload as Record<string, unknown>
  if (typeof row.expectedRevision !== 'number' || !Number.isInteger(row.expectedRevision) || row.expectedRevision < 0) return undefined
  const settings = parseSettingsPatch(row.settings)
  if (!settings) return undefined
  return { expectedRevision: row.expectedRevision, settings }
}

export function storedSettings(value: RecapSettings | undefined): RecapSettings {
  const revision = value && typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0
    ? value.revision
    : 0
  return { ...defaultSettings(), revision }
}
