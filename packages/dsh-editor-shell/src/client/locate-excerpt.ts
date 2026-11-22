/**
 * Reveal the written excerpt. Prefer the recorded after-range when it still
 * matches; otherwise require a unique occurrence. Ambiguous duplicates miss.
 */
export function locateExcerpt(text: string, excerpt: string, start?: number): number {
  if (!excerpt) return -1
  if (typeof start === 'number' && start >= 0 && text.slice(start, start + excerpt.length) === excerpt) {
    return start
  }
  const first = text.indexOf(excerpt)
  if (first < 0) return -1
  return text.indexOf(excerpt, first + 1) >= 0 ? -1 : first
}
