/** Keep the native revision guard while capturing the visible textarea selection. */
export function bindTextareaInsertion<T extends { captureInsertion(): { draftRev: number; start: number; end: number } }>(
  actions: T, selection: () => { start: number; end: number; length: number },
): () => void {
  const original = actions.captureInsertion
  const capture = () => {
    const span = original.call(actions)
    const { start, end, length } = selection()
    return { ...span, start: Math.max(0, Math.min(start, length)), end: Math.max(0, Math.min(end, length)) }
  }
  actions.captureInsertion = capture
  return () => { if (actions.captureInsertion === capture) actions.captureInsertion = original }
}
