import { describe, expect, it } from 'vitest'
import { proposalDiffRows } from './proposal-diff.ts'

/* 三段互不相邻的改动（第 5、23、41-42 行）：段间与两端都隔着超过 6 行
   未改动内容，3 行上下文必须产生 3 个 hunk + 4 条折叠缝。 */
const oldText = [
  'a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08',
  'b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10',
  'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08',
  'd01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07', 'd08', 'd09', 'd10',
  'e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08',
].join('\n')
const newText = oldText
  .replace('a05', 'a05改')
  .replace('c05', 'c05改')
  .replace('e05\ne06', 'e05改\ne06增')

describe('proposalDiffRows', () => {
  it('emits one hunk per changed region with three lines of context', () => {
    const rows = proposalDiffRows(oldText, newText)
    const hunks = rows.flatMap((row) => (row.kind === 'hunk' ? [row.hunk] : []))
    expect(hunks).toHaveLength(3)
    /* 三个 hunk 的旧坐标覆盖分别是 2..8、20..26、38..44（尾部不足 3 行
       上下文时收到文件末尾）。 */
    expect(hunks.map((hunk) => [hunk.oldStart, hunk.oldLines])).toEqual([[2, 7], [20, 7], [38, 7]])
    for (const hunk of hunks) {
      expect(hunk.lines.slice(0, 3).every((line) => line.kind === 'context')).toBe(true)
    }
    expect(hunks[0].lines.slice(-3).every((line) => line.kind === 'context')).toBe(true)
    expect(hunks[2].lines.slice(-2).every((line) => line.kind === 'context')).toBe(true)
    expect(hunks[0].lines).toContainEqual({ kind: 'del', text: 'a05' })
    expect(hunks[0].lines).toContainEqual({ kind: 'add', text: 'a05改' })
    expect(hunks[2].lines).toContainEqual({ kind: 'del', text: 'e05' })
    expect(hunks[2].lines).toContainEqual({ kind: 'add', text: 'e05改' })
    expect(hunks[2].lines).toContainEqual({ kind: 'add', text: 'e06增' })
  })

  it('folds unchanged runs into gap rows carrying their hidden lines', () => {
    const rows = proposalDiffRows(oldText, newText)
    const gaps = rows.flatMap((row) => (row.kind === 'gap' ? [row] : []))
    /* 1 行领头 + 11 + 11 行间 = 23 行折叠；e07/e08 已作尾部上下文在 hunk 里。 */
    expect(gaps.map((gap) => gap.hiddenLines)).toEqual([1, 11, 11])
    expect(gaps[0].lines).toEqual(['a01'])
    expect(gaps[1].lines).toEqual(['b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10', 'c01'])
    expect(gaps[2].lines).toEqual(['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07', 'd08', 'd09', 'd10', 'e01'])
  })

  it('produces a single hunk for adjacent changes with no gaps', () => {
    const rows = proposalDiffRows('x1\nx2\nx3', 'x1\ny2\nx3')
    expect(rows.filter((row) => row.kind === 'hunk')).toHaveLength(1)
    expect(rows.filter((row) => row.kind === 'gap')).toHaveLength(0)
  })
})
