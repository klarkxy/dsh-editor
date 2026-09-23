import type { DreamPlan, MemoryPersistedState } from './contracts.ts'
import { MAX_MEMORY_DREAMS, MAX_MEMORY_RECORDS, MAX_MEMORY_TOMBSTONES } from './storage.ts'

const TERMINAL_DREAM = new Set<DreamPlan['status']>(['applied', 'cancelled', 'stale', 'failed', 'noop'])

export function memoryStateOverCapacity(state: MemoryPersistedState): boolean {
  return state.records.length > MAX_MEMORY_RECORDS
    || state.tombstones.length > MAX_MEMORY_TOMBSTONES
    || state.dreams.length > MAX_MEMORY_DREAMS
}

export function protectedTombstoneIds(state: MemoryPersistedState, activePlanIds: ReadonlySet<string> = new Set()): Set<string> {
  const ids = new Set<string>(activePlanIds)
  for (const record of state.records) {
    for (const ref of record.basis ?? []) ids.add(ref.id)
    for (const sourceId of record.supersedes ?? []) ids.add(sourceId)
  }
  for (const plan of state.dreams) {
    for (const entry of plan.snapshot) ids.add(entry.id)
    for (const proposal of plan.proposals) {
      for (const sourceId of proposal.sourceIds) ids.add(sourceId)
    }
  }
  return ids
}

/** Drop oldest unused terminal dreams, then unreferenced tombstones, only when a bound is exceeded. */
export function compactMemoryState(state: MemoryPersistedState, activePlanIds: ReadonlySet<string> = new Set()): void {
  if (state.dreams.length > MAX_MEMORY_DREAMS) {
    const droppable = state.dreams
      .filter(plan => TERMINAL_DREAM.has(plan.status) && !activePlanIds.has(plan.id))
      .sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
    const dropIds = new Set(droppable.slice(0, state.dreams.length - MAX_MEMORY_DREAMS).map(plan => plan.id))
    if (dropIds.size) state.dreams = state.dreams.filter(plan => !dropIds.has(plan.id))
  }
  if (state.tombstones.length > MAX_MEMORY_TOMBSTONES) {
    const protectedIds = protectedTombstoneIds(state, activePlanIds)
    const droppable = state.tombstones
      .filter(row => !protectedIds.has(row.id))
      .sort((left, right) => left.deletedAt - right.deletedAt || left.id.localeCompare(right.id))
    const dropIds = new Set(droppable.slice(0, state.tombstones.length - MAX_MEMORY_TOMBSTONES).map(row => row.id))
    if (dropIds.size) state.tombstones = state.tombstones.filter(row => !dropIds.has(row.id))
  }
}
