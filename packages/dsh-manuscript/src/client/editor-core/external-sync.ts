/**
 * Rebase disk text into the live editor buffer for `syncFromDisk`.
 * Line-level diff (common prefix/suffix trim, then LCS with a cell budget);
 * the remote change is applied only when it does not touch the author's edits.
 */
import { ChangeSet } from '@codemirror/state'

export type ExternalChange = { from: number; to: number; insert: string }
export type RebaseResult =
  | { kind: 'apply'; changes: ExternalChange[]; highlights: { from: number; to: number }[]; merged: string }
  | { kind: 'conflict' }
  | { kind: 'unavailable' }

/** Product of middle-line counts above which the diff collapses to one region. */
const LCS_CELL_BUDGET = 400_000

function splitLines(text: string): string[] {
  const lines = text.split(/(?<=\n)/)
  // ''.split produces one empty line; a trailing '\n' also yields a final ''
  // part that belongs to the previous line's terminator, so drop it.
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function offsets(lines: readonly string[]): number[] {
  const out = [0]
  for (const line of lines) out.push(out[out.length - 1]! + line.length)
  return out
}

/** Ordered non-overlapping change specs turning `a` into `b`, in `a` offsets. */
export function diffText(a: string, b: string): ExternalChange[] {
  if (a === b) return []
  const aLines = splitLines(a)
  const bLines = splitLines(b)
  const aAt = offsets(aLines)
  const bAt = offsets(bLines)
  let pre = 0
  while (pre < aLines.length && pre < bLines.length && aLines[pre] === bLines[pre]) pre += 1
  let suf = 0
  while (suf < aLines.length - pre && suf < bLines.length - pre
    && aLines[aLines.length - 1 - suf] === bLines[bLines.length - 1 - suf]) suf += 1
  const aMid = aLines.slice(pre, aLines.length - suf)
  const bMid = bLines.slice(pre, bLines.length - suf)
  if (aMid.length * bMid.length > LCS_CELL_BUDGET) {
    return [{ from: aAt[pre]!, to: aAt[aLines.length - suf]!, insert: bMid.join('') }]
  }
  // LCS table over the middle lines; kept pairs split the middle into changes.
  const m = aMid.length
  const n = bMid.length
  const width = n + 1
  const dp = new Uint32Array((m + 1) * width)
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i * width + j] = aMid[i] === bMid[j]
        ? dp[(i + 1) * width + j + 1]! + 1
        : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!)
    }
  }
  const changes: ExternalChange[] = []
  let i = 0
  let j = 0
  let aFrom = -1
  let bFrom = -1
  const flush = () => {
    if (aFrom === -1) return
    changes.push({
      from: aAt[pre + aFrom]!,
      to: aAt[pre + i]!,
      insert: bMid.slice(bFrom, j).join(''),
    })
    aFrom = -1
  }
  while (i < m && j < n) {
    if (aMid[i] === bMid[j]) { flush(); i += 1; j += 1; continue }
    if (aFrom === -1) { aFrom = i; bFrom = j }
    if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) i += 1
    else j += 1
  }
  while (i < m) { if (aFrom === -1) { aFrom = i; bFrom = j } i += 1 }
  while (j < n) { if (aFrom === -1) { aFrom = i; bFrom = j } j += 1 }
  flush()
  return changes
}

function applyChanges(text: string, changes: readonly ExternalChange[]): string {
  let next = text
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    next = next.slice(0, change.from) + change.insert + next.slice(change.to)
  }
  return next
}

function touches(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  // An insertion conflicts only strictly inside a changed range or at the same
  // point as another insertion; replaced/deleted ranges must actually overlap.
  // Boundary-adjacent edits map deterministically and are allowed to merge.
  const aPoint = a.from === a.to
  const bPoint = b.from === b.to
  if (aPoint && bPoint) return a.from === b.from
  if (aPoint) return b.from < a.from && a.from < b.to
  if (bPoint) return a.from < b.from && b.from < a.to
  return a.from < b.to && b.from < a.to
}

/**
 * Fold `theirs` (disk) into `mine` (buffer), where both diverged from `base`
 * (the last synced document text). Changes and highlight ranges are reported
 * in `mine`/full-text offsets; `merged` is the exact resulting buffer text.
 * `protectedPrefix` (hidden projected header length) makes any change that
 * would touch it return 'unavailable' so the caller falls back to a reload.
 */
export function rebaseExternal(
  base: string,
  mine: string,
  theirs: string,
  options?: { protectedPrefix?: number },
): RebaseResult {
  const authorChanges = diffText(base, mine)
  const theirChanges = diffText(base, theirs)
  if (!theirChanges.length) {
    return { kind: 'apply', changes: [], highlights: [], merged: mine }
  }
  const authorSet = ChangeSet.of(
    authorChanges.map((change) => ({ from: change.from, to: change.to, insert: change.insert })),
    base.length,
  )
  const overlapping = authorChanges.some((a) => theirChanges.some((b) => touches(a, b)))
  if (overlapping) return { kind: 'conflict' }
  // Map positions only: routing inserts through a Text round-trip would
  // normalize CRLF to LF. Boundary assoc keeps author inserts outside ranges.
  const changes: ExternalChange[] = theirChanges.map((change) => ({
    from: authorSet.mapPos(change.from, 1),
    to: change.from === change.to ? authorSet.mapPos(change.to, 1) : authorSet.mapPos(change.to, -1),
    insert: change.insert,
  }))
  const highlights: { from: number; to: number }[] = []
  let delta = 0
  for (const change of changes) {
    if (change.insert.length) {
      highlights.push({ from: change.from + delta, to: change.from + delta + change.insert.length })
    }
    delta += change.insert.length - (change.to - change.from)
  }
  const prefix = options?.protectedPrefix ?? 0
  if (changes.some((change) => change.from < prefix || change.to < prefix)) {
    return { kind: 'unavailable' }
  }
  const merged = applyChanges(mine, changes)
  return { kind: 'apply', changes, highlights, merged }
}
