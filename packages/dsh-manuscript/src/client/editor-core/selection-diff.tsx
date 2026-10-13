import { useMemo, type CSSProperties } from 'react'
import { createTextDiff, type TextDiffPart } from './text-diff.ts'

/* 差分ハイライトの seats トークン配色をモジュール定数に集約。 */
const DIFF_DELETE_STYLE: CSSProperties = {
  background: 'var(--s-danger-soft)',
  color: 'var(--s-danger)',
  textDecoration: 'line-through',
}
const DIFF_INSERT_STYLE: CSSProperties = {
  background: 'var(--s-success-soft)',
  color: 'var(--s-success)',
  textDecoration: 'underline',
}

function DiffText(props: { parts: TextDiffPart[]; side: 'original' | 'revised' }) {
  return <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
    {props.parts.map((part, index) => {
      if (part.kind === 'equal') return <span key={index}>{part.text}</span>
      if (part.kind === 'delete' && props.side === 'original') return <del key={index} style={DIFF_DELETE_STYLE}>{part.text}</del>
      if (part.kind === 'insert' && props.side === 'revised') return <ins key={index} style={DIFF_INSERT_STYLE}>{part.text}</ins>
      return null
    })}
  </p>
}

/** The proposal text, not this display-only diff, remains the write authority. */
export function SelectionDiff(props: { original: string; revised: string }) {
  const diff = useMemo(() => createTextDiff(props.original, props.revised), [props.original, props.revised])
  return <>
    <small>删除以划线标记，新增以下划线标记。{diff.coarse ? '文本较长，部分改动按整段显示。' : ''}</small>
    <div className="selection-diff" aria-label="修改文字对照">
      <section className="selection-diff-original">
        <small>原文</small>
        <DiffText parts={diff.parts} side="original" />
      </section>
      <section className="selection-diff-revised">
        <small>修改后</small>
        <DiffText parts={diff.parts} side="revised" />
      </section>
    </div>
  </>
}
