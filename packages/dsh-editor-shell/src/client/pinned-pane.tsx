import { useEffect, useRef, useState } from 'react';
import { Callout, Flex, Heading, IconButton, ScrollArea, Text } from '@radix-ui/themes'
import { stripChapterFrontmatter } from 'dsh-editor-workbench/contracts'
import { documentName, errorMessage, LatestRequestGate, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'
import { FileIcon, PinIcon } from './icons.tsx'
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
    <Flex
      asChild
      direction="column"
      minWidth="0"
      minHeight="0"
      overflow="hidden"
      height="100%">
      <section className="pinned-pane" aria-label={t('pin.aria', { path: props.path })}>
        <Flex asChild align="start" justify="between" gap="3" px="5" pt="4" pb="3">
          <header className="pinned-header">
            <Flex direction="column" gap="1" minWidth="0">
              <Heading size="4" title={props.path} truncate>
                {title}
              </Heading>
              <Text className="pinned-path" size="1" color="gray" title={props.path} truncate>
                {props.path}
              </Text>
            </Flex>
            <Flex className="pinned-actions" align="center" gap="2">
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="2"
                title={t('pin.unpin')}
                aria-label={t('pin.unpin')}
                onClick={props.onUnpin}>
                <PinIcon size={16} />
              </IconButton>
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="2"
                title={t('pin.openEditor')}
                aria-label={t('pin.openEditor')}
                onClick={() => props.onOpenDocument(props.path)}>
                <FileIcon size={16} />
              </IconButton>
            </Flex>
          </header>
        </Flex>
        <ScrollArea className="pinned-body" type="auto" scrollbars="vertical">
          <Flex direction="column" gap="4" px="5" pt="4" pb="6">
            {busy ? <div role="status" aria-live="polite">
              <ActivitySkeleton lines={6} className="pinned-loading" />
              <span className="sr-only">
                {t('pin.loading')}
              </span>
            </div> : null}
            {note ? <Callout.Root className="warning" color="red" size="1" role="alert">
              <Callout.Text>
                {note}
              </Callout.Text>
            </Callout.Root> : null}
            {!busy && text !== null ? <div className="pinned-markdown md activity-reveal">
              <Markdown text={markdownBody} />
            </div> : null}
          </Flex>
        </ScrollArea>
      </section>
    </Flex>
  );
}
