/** Display-only diff. Never use its segments to reconstruct a file write. */
export type TextDiffPart = { kind: 'equal' | 'delete' | 'insert'; text: string }
export type TextDiff = { parts: TextDiffPart[]; coarse: boolean }

const MAX_TEXT_LENGTH = 200_000
const MAX_TOKENS = 12_000
const MAX_CELLS = 500_000

type Budget = { cells: number; coarse: boolean }

function append(parts: TextDiffPart[], kind: TextDiffPart['kind'], text: string): void {
  if (!text) return
  const last = parts[parts.length - 1]
  if (last?.kind === kind) last.text += text
  else parts.push({ kind, text })
}

/** Keep line endings, punctuation and spaces exactly as received. */
function lines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []
}

export function segmentDiffText(text: string): string[] {
  for (const granularity of ['word', 'grapheme'] as const) {
    try {
      const tokens = Array.from(new Intl.Segmenter('zh', { granularity }).segment(text), (item) => item.segment)
      // An incomplete/polyfilled segmenter must never silently drop source text.
      if (tokens.join('') === text) return tokens
    } catch { /* Older runtimes may lack the native segmenter; editing still works. */ }
  }
  return Array.from(text)
}

function sequenceDiff(before: string[], after: string[], budget: Budget): TextDiffPart[] {
  const parts: TextDiffPart[] = []
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  append(parts, 'equal', before.slice(0, start).join(''))
  const rows = beforeEnd - start
  const columns = afterEnd - start
  const cells = (rows + 1) * (columns + 1)
  if (!rows || !columns) {
    append(parts, 'delete', before.slice(start, beforeEnd).join(''))
    append(parts, 'insert', after.slice(start, afterEnd).join(''))
  } else if (cells > budget.cells || rows + columns > MAX_TOKENS) {
    budget.coarse = true
    append(parts, 'delete', before.slice(start, beforeEnd).join(''))
    append(parts, 'insert', after.slice(start, afterEnd).join(''))
  } else {
    budget.cells -= cells
    const width = columns + 1
    const table = new Uint32Array(cells)
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let column = columns - 1; column >= 0; column -= 1) {
        const index = row * width + column
        table[index] = before[start + row] === after[start + column]
          ? table[index + width + 1]! + 1
          : Math.max(table[index + width]!, table[index + 1]!)
      }
    }
    let row = 0
    let column = 0
    while (row < rows || column < columns) {
      if (row < rows && column < columns && before[start + row] === after[start + column]) {
        append(parts, 'equal', before[start + row]!)
        row += 1
        column += 1
      } else if (row < rows && (column === columns || table[(row + 1) * width + column]! >= table[row * width + column + 1]!)) {
        append(parts, 'delete', before[start + row]!)
        row += 1
      } else {
        append(parts, 'insert', after[start + column]!)
        column += 1
      }
    }
  }
  append(parts, 'equal', before.slice(beforeEnd).join(''))
  return parts
}

/** Align unchanged paragraphs first, then compare words only in changed runs. */
export function createTextDiff(before: string, after: string): TextDiff {
  if (before === after) return { parts: before ? [{ kind: 'equal', text: before }] : [], coarse: false }
  if (before.length + after.length > MAX_TEXT_LENGTH) {
    const parts: TextDiffPart[] = []
    append(parts, 'delete', before)
    append(parts, 'insert', after)
    return { parts, coarse: true }
  }
  const budget: Budget = { cells: MAX_CELLS, coarse: false }
  const aligned = sequenceDiff(lines(before), lines(after), budget)
  const parts: TextDiffPart[] = []
  for (let index = 0; index < aligned.length;) {
    const part = aligned[index]!
    if (part.kind === 'equal') {
      append(parts, 'equal', part.text)
      index += 1
      continue
    }
    let removed = ''
    let added = ''
    while (index < aligned.length && aligned[index]!.kind !== 'equal') {
      const change = aligned[index++]!
      if (change.kind === 'delete') removed += change.text
      else added += change.text
    }
    if (!removed || !added) {
      append(parts, 'delete', removed)
      append(parts, 'insert', added)
      continue
    }
    for (const change of sequenceDiff(segmentDiffText(removed), segmentDiffText(added), budget)) {
      append(parts, change.kind, change.text)
    }
  }
  return { parts, coarse: budget.coarse }
}
