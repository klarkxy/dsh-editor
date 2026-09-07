/** After a successful save, wait this long before recording today's totals. */
export const PROGRESS_RECORD_DEBOUNCE_MS = 5_000

export type DebounceClock = {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export type DebouncedInvoker = {
  schedule(task: () => void): void
  cancel(): void
}

/** Collapse rapid triggers into one call after `delayMs`. Failures stay with the caller. */
export function createDebouncedInvoker(delayMs: number, clock: DebounceClock = globalThis): DebouncedInvoker {
  let handle: unknown
  return {
    schedule(task) {
      if (handle !== undefined) clock.clearTimeout(handle)
      handle = clock.setTimeout(() => {
        handle = undefined
        task()
      }, delayMs)
    },
    cancel() {
      if (handle === undefined) return
      clock.clearTimeout(handle)
      handle = undefined
    },
  }
}

export function progressRecordChars(overview: { totals: { chars: number } } | null | undefined): number | null {
  const chars = overview?.totals.chars
  if (typeof chars !== 'number' || !Number.isInteger(chars) || chars < 0) return null
  return chars
}
