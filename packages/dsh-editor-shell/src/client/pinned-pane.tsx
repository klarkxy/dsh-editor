import { useEffect, useRef, useState } from 'react';
import { stripChapterFrontmatter } from 'dsh-editor-workbench/contracts'
import { documentName, errorMessage, LatestRequestGate, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'
import { Markdown } from './markdown.tsx'
import { ActivitySkeleton } from './ui/index.ts'
import { readableDocumentTitle } from '../wrap-up-view.ts'

/* 首个 ATX 标题的纯文本(去掉行内标记),用于与文档标题去重。 */
function firstHeadingPlainText(body: string): string {
  const match = body.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)
  if (!match) return ''
  return match[1]!
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

export function PinnedPane(props: {
  ctx: ShellContext
  sessionId: string
  path: string
  treeRevision: number
  contentRevision: number
  onUnpin(): void
  onOpenDocument(path: string): void
  onMissing(): void
}) {
  const [text, setText] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.path}\u0000${props.treeRevision}\u0000${props.contentRevision}`
  requestGate.setScope(requestScope)

  useEffect(() => {
    const ticket = requestGate.begin(requestScope)
    let live = true
    setBusy(true)
    setNote('')
    void (async () => {
      const read = await safeRpcCall<{ text: string; version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
        sessionId: props.sessionId,
        path: props.path,
      }))
      if (!live || !requestGate.isCurrent(ticket)) return
      if (!read.ok) {
        setBusy(false)
        setText(null)
        setNote(errorMessage(read))
        const blob = `${read.error.code ?? ''} ${read.error.message ?? ''}`
        if (/not-found|missing/i.test(blob)) props.onMissing()
        return
      }
      setText(read.value.text)
      setBusy(false)
    })()
    return () => { live = false }
  }, [props.ctx.connection.rpc, props.sessionId, props.path, props.treeRevision, props.contentRevision, requestScope, requestGate])

  const title = text ? readableDocumentTitle(props.path, text) : documentName(props.path)
  const body = text === null ? '' : stripChapterFrontmatter(text)
  const firstHeading = firstHeadingPlainText(body)
  const markdownBody = firstHeading.trim() === title.trim()
    ? body.replace(/^\s{0,3}#{1,6}\s+.*(?:\r?\n)+/, '')
    : body

  return (
    <section className="pinned-pane" aria-label={t('pin.aria', { path: props.path })}>
      <header className="pinned-header">
        <div>
          <h2 title={props.path}>
            {title}
          </h2>
          <p className="muted pinned-path" title={props.path}>
            {props.path}
          </p>
        </div>
        <div className="pinned-actions">
          <button type="button" onClick={props.onUnpin}>
            {t('pin.unpin')}
          </button>
          <button type="button" onClick={() => props.onOpenDocument(props.path)}>
            {t('pin.openEditor')}
          </button>
        </div>
      </header>
      <div className="pinned-body">
        {busy ? <div role="status" aria-live="polite">
          <ActivitySkeleton lines={6} className="pinned-loading" />
          <span className="sr-only">
            {t('pin.loading')}
          </span>
        </div> : null}
        {note ? <p className="warning" role="status">
          {note}
        </p> : null}
        {!busy && text !== null ? <div className="pinned-markdown md activity-reveal">
          <Markdown text={markdownBody} />
        </div> : null}
      </div>
    </section>
  );
}
