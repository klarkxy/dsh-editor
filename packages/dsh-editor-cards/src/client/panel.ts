import { createElement as e, useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import {
  CARDS_RPC_CHANNEL,
  type CardKind,
  type CardReferenceHit,
  type CardsCreateResponse,
  type CardsListResponse,
  type CardsReferencesResponse,
  type CharacterCard,
  type WorldbookCard,
} from '../contracts.ts'
import type { ShellRange, ShellToolSeatContext } from 'dsh-editor-seats'
import {
  UNGROUPED_ROLE,
  collectCharacterRoles,
  collectTags,
  collectWorldbookCategories,
  groupCharacterCards,
  groupReferencesByChapter,
  groupWorldbookCards,
  toggleFilterValue,
  visibleCharacterCards,
  visibleWorldbookCards,
  ungroupedRoleLabel,
  worldbookCategoryLabel,
  type CardSortKey,
} from '../cards-view.ts'
import { TextPromptDialog } from './dialog.ts'
import { renderSelect } from './host-ui.ts'
import { errorMessage, LatestRequestGate, safeRpcCall } from './rpc.ts'
import { setCardsLocale, t } from './messages.ts'
import { consumeCardsRequest, pendingCardsRequest, subscribeCardsRequest } from './requests.ts'
import {
  bindCardsSession,
  closeCardsDetail,
  closeCardsPanel,
  getCardsState,
  openCardsPanel,
  selectCard,
  setCardsCatalog,
  subscribeCardsStore,
  type CardsCatalog,
} from './store.ts'

export type RpcCaller = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export type CardsSeatProps = ShellToolSeatContext & { rpc: RpcCaller }

const EMPTY_CATALOG: CardsCatalog = { characters: [], worldbook: [] }

export type ReferenceState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'error'; note: string }
  | { status: 'ready'; value: CardsReferencesResponse }

function emptyRefs(): Record<string, ReferenceState> {
  return {}
}

export function CardsPanelSeat(props: CardsSeatProps) {
  setCardsLocale(props.locale)
  const store = useSyncExternalStore(subscribeCardsStore, getCardsState, getCardsState)
  useEffect(() => {
    bindCardsSession(props.sessionId)
  }, [props.sessionId])
  const lastActivePath = useRef(props.activePath)
  useEffect(() => {
    if (lastActivePath.current === props.activePath) return
    lastActivePath.current = props.activePath
    closeCardsDetail()
  }, [props.activePath])
  useEffect(() => {
    const pending = pendingCardsRequest()
    if (pending) {
      openCardsPanel(pending.kind)
      consumeCardsRequest(pending)
    }
    return subscribeCardsRequest((request) => {
      openCardsPanel(request.kind)
      consumeCardsRequest(request)
    })
  }, [])
  useEffect(() => {
    props.highlightTreePath(store.selectedPath)
  }, [store.selectedPath, props.highlightTreePath])
  if (!store.open || !props.sessionId) return null
  return e(CardsPanel, {
    ...props,
    kind: store.kind,
    selectedPath: store.selectedPath,
  })
}

function CardsPanel(props: CardsSeatProps & { kind: CardKind; selectedPath: string | null }) {
  const [catalog, setCatalog] = useState<CardsCatalog>(EMPTY_CATALOG)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [text, setText] = useState('')
  const [roleChips, setRoleChips] = useState<string[]>([])
  const [categoryChips, setCategoryChips] = useState<string[]>([])
  const [tagChips, setTagChips] = useState<string[]>([])
  const [sort, setSort] = useState<CardSortKey>('title')
  const [refs, setRefs] = useState<Record<string, ReferenceState>>(emptyRefs)
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createNote, setCreateNote] = useState('')
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.treeRevision}`
  requestGate.setScope(requestScope)

  const load = async () => {
    const ticket = requestGate.begin(requestScope)
    setBusy(true)
    setNote('')
    const listed = await safeRpcCall<CardsListResponse>(() => props.rpc.call(CARDS_RPC_CHANNEL, 'cards.list', {
      sessionId: props.sessionId,
      kind: 'all',
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!listed.ok) {
      setCatalog(EMPTY_CATALOG)
      setCardsCatalog(EMPTY_CATALOG)
      setNote(errorMessage(listed, props.locale))
      setTruncated(false)
      return
    }
    const next = { characters: listed.value.characters, worldbook: listed.value.worldbook }
    setCatalog(next)
    setCardsCatalog(next)
    setTruncated(listed.value.truncated)
    setNote(listed.value.truncated ? t('cards.truncated') : '')
  }

  useEffect(() => {
    setText('')
    setRoleChips([])
    setCategoryChips([])
    setTagChips([])
  }, [props.sessionId])

  useEffect(() => {
    setRefs(emptyRefs())
    void load()
  }, [props.sessionId, props.treeRevision])

  const openHit = async (hit: CardReferenceHit) => {
    if (props.editorDirty) return
    const read = await safeRpcCall<{ version: string }>(() => props.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: hit.path,
    }))
    if (!read.ok) { setNote(errorMessage(read, props.locale)); return }
    closeCardsDetail()
    props.openDocument(hit.path, { ...hit, version: read.value.version } satisfies ShellRange)
  }

  const loadReferences = async (path: string) => {
    const current = refs[path]
    if (current?.status === 'busy') return
    setRefs((old) => ({ ...old, [path]: { status: 'busy' } }))
    const result = await safeRpcCall<CardsReferencesResponse>(() => props.rpc.call(CARDS_RPC_CHANNEL, 'cards.references', {
      sessionId: props.sessionId,
      path,
    }))
    setRefs((old) => ({
      ...old,
      [path]: result.ok ? { status: 'ready', value: result.value } : { status: 'error', note: errorMessage(result, props.locale) },
    }))
  }

  const createCard = async (title: string) => {
    if (createBusy) return
    setCreateBusy(true)
    setCreateNote('')
    const created = await safeRpcCall<CardsCreateResponse>(() => props.rpc.call(CARDS_RPC_CHANNEL, 'cards.create', {
      sessionId: props.sessionId,
      kind: props.kind,
      title,
    }))
    setCreateBusy(false)
    if (!created.ok) { setCreateNote(errorMessage(created, props.locale)); return }
    setCreateOpen(false)
    setCreateNote('')
    props.refresh('tree')
    props.expandTreePath(created.value.path)
    props.openDocument(created.value.path)
  }

  const characters = visibleCharacterCards(catalog.characters, { text, roles: roleChips, tags: tagChips, sort })
  const worldbook = visibleWorldbookCards(catalog.worldbook, { text, categories: categoryChips, tags: tagChips, sort })
  const characterGroups = groupCharacterCards(characters)
  const worldbookGroups = groupWorldbookCards(worldbook)
  const roleOptions = collectCharacterRoles(catalog.characters)
  const categoryOptions = collectWorldbookCategories(catalog.worldbook)
  const tagOptions = collectTags(props.kind === 'character' ? catalog.characters : catalog.worldbook)
  const title = props.kind === 'character' ? t('cards.characters') : t('cards.worldbook')
  const emptyLabel = props.kind === 'character' ? t('cards.noPeople') : t('cards.noWorld')
  const list = props.kind === 'character' ? characterGroups : worldbookGroups
  const sortOptions = [
    { value: 'title', label: t('cards.sortName') },
    { value: 'modified', label: t('cards.sortModified') },
    props.kind === 'character' ? { value: 'role', label: t('cards.sortRole') } : { value: 'category', label: t('cards.sortCategory') },
  ]
  return e('section', { className: 'cards-panel', 'data-testid': 'cards-panel', 'aria-label': title },
    e('header', { className: 'cards-panel-header' },
      e('h2', null, title),
      e('button', { className: 'icon-button', type: 'button', 'aria-label': t('cards.closePanel'), onClick: () => closeCardsPanel() }, '×'),
    ),
    e('div', { className: 'cards-tabs', role: 'tablist', 'aria-label': t('cards.kind') },
      e('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': props.kind === 'character',
        onClick: () => openCardsPanel('character'),
      }, t('cards.person')),
      e('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': props.kind === 'worldbook',
        onClick: () => openCardsPanel('worldbook'),
      }, t('cards.setting')),
    ),
    e('div', { className: 'cards-toolbar' },
      e('input', {
        value: text,
        maxLength: 80,
        placeholder: props.kind === 'character' ? t('cards.filterPeople') : t('cards.filterWorld'),
        'aria-label': t('cards.filter'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value),
      }),
      renderSelect(props.Select, {
        value: sort,
        'aria-label': t('cards.sort'),
        options: sortOptions,
        onChange: (next) => {
          if (next === 'title' || next === 'modified' || next === 'role' || next === 'category') setSort(next)
        },
      }),
      e('button', { type: 'button', onClick: () => { setCreateNote(''); setCreateOpen(true) } }, props.kind === 'character' ? t('cards.newPerson') : t('cards.newSetting')),
    ),
    roleOptions.length && props.kind === 'character' ? e(ChipRow, {
      label: t('cards.role'),
      values: roleOptions,
      selected: roleChips,
      onToggle: (value) => setRoleChips((old) => toggleFilterValue(old, value)),
      display: (value) => value === UNGROUPED_ROLE ? ungroupedRoleLabel() : value,
    }) : null,
    categoryOptions.length && props.kind === 'worldbook' ? e(ChipRow, {
      label: t('cards.category'),
      values: categoryOptions,
      selected: categoryChips,
      onToggle: (value) => setCategoryChips((old) => toggleFilterValue(old, value)),
      display: worldbookCategoryLabel,
    }) : null,
    tagOptions.length ? e(ChipRow, {
      label: t('cards.tags'),
      values: tagOptions,
      selected: tagChips,
      onToggle: (value) => setTagChips((old) => toggleFilterValue(old, value)),
    }) : null,
    busy ? e('p', { className: 'cards-status muted', role: 'status' }, t('cards.loading')) : null,
    note ? e('p', { className: `cards-status ${truncated ? 'warning' : 'muted'}`, role: note && !truncated && !busy ? 'alert' : 'status' },
      note,
      !busy && !truncated && note && !list.length ? e('button', { type: 'button', onClick: () => void load() }, t('cards.retry')) : null,
    ) : null,
    !busy && !list.length && !(note && !truncated) ? e('p', { className: 'cards-status muted' }, emptyLabel) : null,
    props.kind === 'character' && characterGroups.length
      ? e('div', { className: 'cards-groups' }, characterGroups.map((group) => e('section', { key: group.key, className: 'cards-group' },
        e('h3', null, group.key === UNGROUPED_ROLE ? ungroupedRoleLabel() : group.label),
        e('ul', { className: 'cards-list' }, group.cards.map((card) => e(CharacterCardRow, {
          key: card.path,
          card,
          selected: props.selectedPath === card.path,
          refs: refs[card.path] ?? { status: 'idle' },
          navigationBlocked: props.editorDirty,
          onSelect: () => selectCard(card.path),
          onReferences: () => void loadReferences(card.path),
          onOpenHit: (item) => void openHit(item),
        }))),
      )))
      : null,
    props.kind === 'worldbook' && worldbookGroups.length
      ? e('div', { className: 'cards-groups' }, worldbookGroups.map((group) => e('section', { key: group.key, className: 'cards-group' },
        e('h3', null, worldbookCategoryLabel(group.key)),
        e('ul', { className: 'cards-list' }, group.cards.map((card) => e(WorldbookCardRow, {
          key: card.path,
          card,
          selected: props.selectedPath === card.path,
          refs: refs[card.path] ?? { status: 'idle' },
          navigationBlocked: props.editorDirty,
          onSelect: () => selectCard(card.path),
          onReferences: () => void loadReferences(card.path),
          onOpenHit: (item) => void openHit(item),
        }))),
      )))
      : null,
    e(TextPromptDialog, {
      Dialog: props.Dialog,
      id: 'cards-create',
      open: createOpen,
      title: props.kind === 'character' ? t('cards.newPerson') : t('cards.newSetting'),
      label: t('cards.title'),
      initialValue: '',
      confirmLabel: t('common.create'),
      busy: createBusy,
      note: createNote,
      onCancel: () => { if (!createBusy) setCreateOpen(false) },
      onConfirm: (nextTitle: string) => void createCard(nextTitle),
    }),
  )
}

function ChipRow(props: {
  label: string
  values: readonly string[]
  selected: readonly string[]
  onToggle(value: string): void
  display?(value: string): string
}) {
  return e('div', { className: 'cards-chips', 'aria-label': props.label },
    props.values.map((value) => e('button', {
      key: value,
      type: 'button',
      className: 'cards-chip',
      'aria-pressed': props.selected.includes(value),
      onClick: () => props.onToggle(value),
    }, props.display?.(value) ?? value)),
  )
}

function CharacterCardRow(props: {
  card: CharacterCard
  selected: boolean
  refs: ReferenceState
  navigationBlocked: boolean
  onSelect(): void
  onReferences(): void
  onOpenHit(hit: CardReferenceHit): void
}) {
  const { card } = props
  const fields = card.frontmatter
  return e('li', { className: `cards-item${props.selected ? ' selected' : ''}` },
    e('button', { type: 'button', className: 'cards-item-main', 'aria-current': props.selected ? 'true' : undefined, onClick: props.onSelect },
      e('strong', null, card.title),
      e('span', { className: 'cards-meta' },
        fields.role ? e('em', { className: 'cards-badge' }, fields.role) : null,
        fields.faction ? e('span', null, fields.faction) : null,
        fields.status ? e('span', null, fields.status) : null,
      ),
      fields.tags?.length ? e('span', { className: 'cards-tags' }, fields.tags.join(' · ')) : null,
      card.summary ? e('small', null, card.summary) : null,
    ),
    e(ReferenceBlock, { state: props.refs, navigationBlocked: props.navigationBlocked, onRequest: props.onReferences, onOpenHit: props.onOpenHit }),
  )
}

function WorldbookCardRow(props: {
  card: WorldbookCard
  selected: boolean
  refs: ReferenceState
  navigationBlocked: boolean
  onSelect(): void
  onReferences(): void
  onOpenHit(hit: CardReferenceHit): void
}) {
  const { card } = props
  const fields = card.frontmatter
  return e('li', { className: `cards-item${props.selected ? ' selected' : ''}` },
    e('button', { type: 'button', className: 'cards-item-main', 'aria-current': props.selected ? 'true' : undefined, onClick: props.onSelect },
      e('strong', null, card.title),
      e('span', { className: 'cards-meta' },
        fields.category ? e('em', { className: 'cards-badge' }, worldbookCategoryLabel(fields.category)) : null,
      ),
      fields.tags?.length ? e('span', { className: 'cards-tags' }, fields.tags.join(' · ')) : null,
      card.summary ? e('small', null, card.summary) : null,
    ),
    e(ReferenceBlock, { state: props.refs, navigationBlocked: props.navigationBlocked, onRequest: props.onReferences, onOpenHit: props.onOpenHit }),
  )
}

export function ReferenceBlock(props: {
  state: ReferenceState
  navigationBlocked: boolean
  onRequest(): void
  onOpenHit(hit: CardReferenceHit): void
}) {
  const label = props.state.status === 'ready'
    ? t('cards.refCount', { count: props.state.value.hits.length })
    : props.state.status === 'busy' ? t('cards.refsEllipsis') : t('cards.refs')
  return e('div', { className: 'cards-refs' },
    e('button', {
      type: 'button',
      className: 'cards-ref-toggle',
      disabled: props.state.status === 'busy',
      onClick: props.onRequest,
    }, label),
    props.state.status === 'error' ? e('p', { className: 'muted' }, props.state.note) : null,
    props.state.status === 'ready' ? e(ReferenceGroups, {
      hits: props.state.value.hits,
      truncated: props.state.value.truncated,
      navigationBlocked: props.navigationBlocked,
      onOpenHit: props.onOpenHit,
    }) : null,
  )
}

export function ReferenceGroups(props: {
  hits: readonly CardReferenceHit[]
  truncated?: boolean
  navigationBlocked: boolean
  onOpenHit(hit: CardReferenceHit): void
}) {
  const grouped = groupReferencesByChapter(props.hits)
  if (!grouped.length) return e('p', { className: 'muted' }, t('cards.noRefs'))
  return e('div', { className: 'cards-ref-groups' },
    props.truncated ? e('p', { className: 'warning' }, t('cards.refsCapped')) : null,
    e('ol', null,     grouped.map((group) => e('li', { key: group.path },
      e('strong', null, group.title),
      e('ul', null, group.hits.map((item, index) => e('li', { key: `${item.path}:${item.start}:${index}` },
        e('button', {
          type: 'button',
          disabled: props.navigationBlocked,
          onClick: () => props.onOpenHit(item),
        }, t('cards.refLine', { line: item.line, excerpt: item.excerpt })),
      ))),
    ))),
  )
}
