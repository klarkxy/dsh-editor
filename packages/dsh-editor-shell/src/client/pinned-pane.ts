import { createElement as e, useEffect, useRef, useState } from 'react'
import {
  stripChapterFrontmatter,
  type CardsListResponse,
  type CharacterCard,
  type WorldbookCard,
} from 'dsh-editor-workbench/contracts'
import { CARDS_RPC_CHANNEL } from 'dsh-editor-cards/contracts'
import {
  characterPinnedFields,
  pinnedPaneKind,
  worldbookPinnedFields,
  type PinnedFieldRow,
} from '../pinned-pane-view.ts'
import { documentName, errorMessage, LatestRequestGate, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'

function fieldList(rows: readonly PinnedFieldRow[]) {
  return e('dl', { className: 'pinned-fields' },
    rows.map((row) => e('div', { key: row.label, className: 'pinned-field' },
      e('dt', null, t(row.label)),
      e('dd', null, row.value),
    )),
  )
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
  const [card, setCard] = useState<CharacterCard | WorldbookCard | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.path}\u0000${props.treeRevision}\u0000${props.contentRevision}`
  requestGate.setScope(requestScope)
  const kind = pinnedPaneKind(props.path)

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
        setCard(null)
        setNote(errorMessage(read))
        const blob = `${read.error.code ?? ''} ${read.error.message ?? ''}`
        if (/not-found|missing/i.test(blob)) props.onMissing()
        return
      }
      setText(read.value.text)
      if (kind === 'card' || kind === 'worldbook') {
        const listed = await safeRpcCall<CardsListResponse>(() => props.ctx.connection.rpc.call(CARDS_RPC_CHANNEL, 'cards.list', {
          sessionId: props.sessionId,
          kind: kind === 'card' ? 'character' : 'worldbook',
        }))
        if (!live || !requestGate.isCurrent(ticket)) return
        if (listed.ok) {
          const found = kind === 'card'
            ? listed.value.characters.find((item) => item.path === props.path)
            : listed.value.worldbook.find((item) => item.path === props.path)
          setCard(found ?? null)
        } else {
          setCard(null)
        }
      } else {
        setCard(null)
      }
      setBusy(false)
    })()
    return () => { live = false }
  }, [props.ctx.connection.rpc, props.sessionId, props.path, props.treeRevision, props.contentRevision, kind, requestScope, requestGate])

  const title = card?.title || documentName(props.path)
  const body = text === null ? '' : stripChapterFrontmatter(text)
  const fields = card
    ? kind === 'card'
      ? characterPinnedFields((card as CharacterCard).frontmatter)
      : [
          ...worldbookPinnedFields((card as WorldbookCard).frontmatter),
          { label: 'common.enable' as const, value: (card as WorldbookCard).frontmatter.enabled === false ? t('common.disable') : t('common.enable') },
        ]
    : []

  return e('section', { className: 'pinned-pane', 'aria-label': t('pin.aria', { path: props.path }) },
    e('header', { className: 'pinned-header' },
      e('div', null,
        e('h2', null, title),
        e('p', { className: 'muted' }, props.path),
      ),
      e('div', { className: 'pinned-actions' },
        e('button', { type: 'button', onClick: props.onUnpin }, t('pin.unpin')),
        e('button', { type: 'button', onClick: () => props.onOpenDocument(props.path) }, t('pin.openEditor')),
      ),
    ),
    e('div', { className: 'pinned-body' },
      busy ? e('p', { className: 'muted', role: 'status' }, t('pin.loading')) : null,
      note ? e('p', { className: 'warning', role: 'status' }, note) : null,
      !busy && fields.length ? fieldList(fields) : null,
      !busy && text !== null ? e('pre', { className: 'pinned-text' }, body) : null,
    ),
  )
}
