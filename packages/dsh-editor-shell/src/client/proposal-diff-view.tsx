import { useMemo, useState } from 'react'
import { t } from '../i18n/index.ts'
import { proposalDiffRows } from '../model/proposal-diff.ts'

/*
 * 编辑提案的 hunk 视图：3 行上下文，未改动段折叠为
 * 「展开未改动的 N 行」按钮行；新建文件提案不走这里（仍是全文块）。
 */
export function ProposalDiffView(props: { before: string; after: string }) {
  const rows = useMemo(() => proposalDiffRows(props.before, props.after), [props.before, props.after])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const expand = (index: number) => setExpanded((current) => new Set(current).add(index))
  return (
    <div className="proposal-hunks" role="group" aria-label={t('chat.proposalDiff')}>
      {rows.map((row, index) => {
        if (row.kind === 'gap') {
          if (expanded.has(index)) {
            return row.lines.map((text, lineIndex) => (
              <div key={`gap:${index}:${lineIndex}`} className="proposal-hunk-line is-context">
                <span className="proposal-hunk-sign" aria-hidden="true"> </span>
                {text || ' '}
              </div>
            ))
          }
          return (
            <button
              key={`gap:${index}`}
              type="button"
              className="proposal-hunk-gap"
              aria-expanded={false}
              onClick={() => expand(index)}>
              {t('chat.expandUnchanged', { count: row.hiddenLines })}
            </button>
          )
        }
        return row.hunk.lines.map((line, lineIndex) => (
          <div
            key={`hunk:${index}:${lineIndex}`}
            className={`proposal-hunk-line is-${line.kind}`}>
            <span className="proposal-hunk-sign" aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
            </span>
            {line.text || ' '}
          </div>
        ))
      })}
    </div>
  )
}
