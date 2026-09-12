/** Capture the invoking element on the false→true open edge, including first mount with open. */
export function takeInvokerOnOpen(open: boolean, wasOpen: { current: boolean }): HTMLElement | null | undefined {
  const opening = open && !wasOpen.current
  wasOpen.current = open
  if (!opening) return undefined
  const active = globalThis.document?.activeElement
  return active && typeof (active as HTMLElement).focus === 'function' && 'isConnected' in active
    ? active as HTMLElement
    : null
}

/** Prefer a caller-supplied stable target (tree row) over the element focused at open (often a dying menuitem). */
export function pickReturnFocus(supplied: HTMLElement | null | undefined, captured: HTMLElement | null): HTMLElement | null {
  return supplied ?? captured
}

/** Ignore stale delayed restores after a later open/close generation. */
export function scheduleReturnFocus(target: HTMLElement | null, generation: { current: number }): void {
  const expected = generation.current
  globalThis.setTimeout(() => {
    if (generation.current !== expected) return
    if (target?.isConnected) target.focus()
  }, 0)
}
