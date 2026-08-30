const GENERIC_REFERENCE_PATHS = new Set([
  '人物卡/人物索引.md',
  '世界书/设定总汇.md',
])

function validQuery(value: string): string | undefined {
  const query = value.trim()
  return query && query.length <= 120 && !/[\u0000-\u001f\u007f]/.test(query) ? query : undefined
}

export type ReferenceQuery = { query?: string; needsInput: boolean }

export function referenceQuery(path: string, text: string, start: number, end: number): ReferenceQuery {
  if (!/^(?:人物卡|世界书)\/.+\.md$/i.test(path)) return { needsInput: true }
  const selection = start >= 0 && end > start ? validQuery(text.slice(start, end)) : undefined
  if (selection) return { query: selection, needsInput: false }
  if (GENERIC_REFERENCE_PATHS.has(path)) return { needsInput: true }
  const heading = /^#{1,6}[ \t]+(.+)$/m.exec(text)?.[1]?.replace(/[ \t]+#+[ \t]*$/, '')
  const title = heading ? validQuery(heading) : undefined
  if (title) return { query: title, needsInput: false }
  const stem = path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const fallback = validQuery(stem)
  return fallback ? { query: fallback, needsInput: false } : { needsInput: true }
}
