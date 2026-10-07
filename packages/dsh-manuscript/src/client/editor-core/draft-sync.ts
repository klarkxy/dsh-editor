export type DraftSyncTimer = {
  schedule(delayMs: number, run: () => void): void
  cancelPending(): void
}

/** Owns the not-yet-fired draft.put/delete timeout so explicit cleanup can drop it. */
export function createDraftSyncTimer(): DraftSyncTimer {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null
  return {
    schedule(delayMs, run) {
      if (timer != null) globalThis.clearTimeout(timer)
      timer = globalThis.setTimeout(() => {
        timer = null
        run()
      }, delayMs)
    },
    cancelPending() {
      if (timer == null) return
      globalThis.clearTimeout(timer)
      timer = null
    },
  }
}
