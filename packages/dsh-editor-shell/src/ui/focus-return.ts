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
  /* 触发控件可能在弹层开着时被卸载重建（「搭档」launcher 在抽屉打开时退场，
     关闭时又挂回新节点）。捕获节点断连时按稳定钩子重查一遍。 */
  const requery = target && (target.dataset?.testid
    ? `[data-testid="${target.dataset.testid}"]`
    : target.id ? `#${target.id}` : null)
  globalThis.setTimeout(() => {
    if (generation.current !== expected) return
    if (target?.isConnected) {
      target.focus()
      return
    }
    const again = requery ? globalThis.document?.querySelector<HTMLElement>(requery) : null
    if (again?.isConnected) again.focus()
  }, 0)
}
