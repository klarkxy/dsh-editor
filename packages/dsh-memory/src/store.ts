import { defaultSettings, type MemoryPersistedState } from './contracts.ts'

export interface MemoryStore {
  load(): MemoryPersistedState
  save(state: MemoryPersistedState): Promise<void>
}

export function emptyMemoryState(): MemoryPersistedState {
  return { settings: defaultSettings(), records: [], tombstones: [], dreams: [] }
}

export function cloneState(state: MemoryPersistedState): MemoryPersistedState {
  return structuredClone(state)
}

export function createMemoryStore(options: { failAfter?: number; initial?: MemoryPersistedState } = {}): MemoryStore & {
  failNext(): void
  holdNextSave(): { started: Promise<void>; release: () => void }
  snapshot(): MemoryPersistedState
} {
  let current = cloneState(options.initial ?? emptyMemoryState())
  let remainingFails = options.failAfter ?? 0
  const gates: Array<{ notifyStarted: () => void; wait: Promise<void> }> = []
  return {
    failNext() { remainingFails += 1 },
    holdNextSave() {
      let notifyStarted = () => {}
      const started = new Promise<void>(resolve => { notifyStarted = resolve })
      let release = () => {}
      const wait = new Promise<void>(resolve => { release = resolve })
      gates.push({ notifyStarted, wait })
      return { started, release: () => release() }
    },
    snapshot() { return cloneState(current) },
    load() { return cloneState(current) },
    async save(next) {
      const gate = gates.shift()
      if (gate) {
        gate.notifyStarted()
        await gate.wait
      }
      if (remainingFails > 0) {
        remainingFails -= 1
        throw new Error('storage write failed')
      }
      current = cloneState(next)
    },
  }
}
