import { createElement as e, useEffect, useRef, useState } from 'react'
import { stripChapterFrontmatter } from 'dsh-editor-workbench/contracts'
import { documentName, errorMessage, LatestRequestGate, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'
import { Markdown, parseBlocks } from './markdown.tsx'
import { ActivitySkeleton } from './ui/index.ts'
import { readableDocumentTitle } from '../wrap-up-view.ts'

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
  const firstHeading = parseBlocks(body).find((block) => block.kind === 'heading')
  const headingText = firstHeading && firstHeading.kind === 'heading'
    ? firstHeading.inlines.map((part) => typeof part === 'string' ? part : part.kind === 'link' ? part.text : part.text).join('')
    : ''
  const markdownBody = headingText.trim() === title.trim()
    ? body.replace(/^\s{0,3}#{1,6}\s+.*(?:\r?\n)+/, '')
    : body

  return e('section', { className: 'pinned-pane', 'aria-label': t('pin.aria', { path: props.path }) },
    e('header', { className: 'pinned-header' },
      e('div', null,
        e('h2', { title: props.path }, title),
        e('p', { className: 'muted pinned-path', title: props.path }, props.path),
      ),
      e('div', { className: 'pinned-actions' },
        e('button', { type: 'button', onClick: props.onUnpin }, t('pin.unpin')),
        e('button', { type: 'button', onClick: () => props.onOpenDocument(props.path) }, t('pin.openEditor')),
      ),
    ),
    e('div', { className: 'pinned-body' },
      busy ? e('div', { role: 'status', 'aria-live': 'polite' },
        e(ActivitySkeleton, { lines: 6, className: 'pinned-loading' }),
        e('span', { className: 'sr-only' }, t('pin.loading')),
      ) : null,
      note ? e('p', { className: 'warning', role: 'status' }, note) : null,
      !busy && text !== null ? e('div', { className: 'pinned-markdown md activity-reveal' }, e(Markdown, { text: markdownBody })) : null,
    ),
  )
}
