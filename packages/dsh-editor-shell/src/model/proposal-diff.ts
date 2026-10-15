import { structuredPatch } from 'diff'

/*
 * 编辑提案的行级差异：jsdiff structuredPatch 产出带上下文的 hunk，
 * 这里把它摊平成渲染行——上下文行、删除行、新增行，以及 hunk 之间
 * 被折叠的未改动段（「展开未改动的 N 行」行内还原）。
 */

export type ProposalDiffLine = { kind: 'context' | 'add' | 'del'; text: string }

export type ProposalDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: ProposalDiffLine[]
}

export type ProposalDiffGap = {
  kind: 'gap'
  /** 折叠的未改动行数。 */
  hiddenLines: number
  /** 展开时按顺序插入的原文行。 */
  lines: string[]
}

export type ProposalDiffRow = { kind: 'hunk'; hunk: ProposalDiffHunk } | ProposalDiffGap

const DIFF_CONTEXT = 3

export function proposalDiffRows(oldText: string, newText: string, context = DIFF_CONTEXT): ProposalDiffRow[] {
  const patch = structuredPatch('old', 'new', oldText, newText, '', '', { context })
  const oldLines = oldText.length ? oldText.split('\n') : []
  const rows: ProposalDiffRow[] = []
  /* 已覆盖到的旧文件行号（0 起，不含）；hunk 之间的未覆盖段就是折叠的
     未改动段，行号同样在旧文件坐标系里。 */
  let covered = 0
  patch.hunks.forEach((hunk, index) => {
    const gapBefore = hunk.oldStart - 1 - covered
    if (gapBefore > 0) {
      rows.push({ kind: 'gap', hiddenLines: gapBefore, lines: oldLines.slice(covered, hunk.oldStart - 1) })
    }
    rows.push({
      kind: 'hunk',
      hunk: {
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines.flatMap((line): ProposalDiffLine[] => {
          const text = line.slice(1)
          if (line.startsWith('-')) return [{ kind: 'del', text }]
          if (line.startsWith('+')) return [{ kind: 'add', text }]
          /* '\\ No newline at end of file' 这类标记行不渲染。 */
          return line.startsWith(' ') ? [{ kind: 'context', text }] : []
        }),
      },
    })
    covered = hunk.oldStart - 1 + hunk.oldLines
    if (index === patch.hunks.length - 1 && covered < oldLines.length) {
      rows.push({ kind: 'gap', hiddenLines: oldLines.length - covered, lines: oldLines.slice(covered) })
    }
  })
  return rows
}
