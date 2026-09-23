import { DREAM_MIN_INTERVAL_MS, DREAM_MIN_MATERIAL } from './contracts.ts'
import type { MemoryRecord, MemoryTombstone } from './contracts.ts'

export function shouldRunIdleDream(input: {
  dreamIdleEnabled: boolean
  pluginActive: boolean
  agentIdle: boolean
  dreamRunning: boolean
  lastActivityAt: number
  now: number
  idleMs: number
  lastAttemptAt?: number
  minIntervalMs?: number
  materialCount: number
  minMaterial?: number
}): boolean {
  if (!input.dreamIdleEnabled || !input.pluginActive || !input.agentIdle || input.dreamRunning) return false
  if (input.now - input.lastActivityAt < input.idleMs) return false
  if (input.lastAttemptAt !== undefined && input.now - input.lastAttemptAt < (input.minIntervalMs ?? DREAM_MIN_INTERVAL_MS)) return false
  return input.materialCount >= (input.minMaterial ?? DREAM_MIN_MATERIAL)
}

export function countDreamMaterial(
  state: {
    records: ReadonlyArray<Pick<MemoryRecord, 'createdAt' | 'updatedAt'>>
    tombstones: ReadonlyArray<Pick<MemoryTombstone, 'deletedAt'>>
  },
  since: number | undefined,
): number {
  if (since === undefined) return state.records.length
  let count = 0
  for (const record of state.records) {
    if (record.createdAt > since || record.updatedAt > since) count += 1
  }
  for (const row of state.tombstones) {
    if (row.deletedAt > since) count += 1
  }
  return count
}

export function nextIdleDeadline(idleAt: number, idleMs: number): number {
  return idleAt + idleMs
}
