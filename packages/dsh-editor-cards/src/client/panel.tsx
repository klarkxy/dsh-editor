import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
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
import { SeatButton } from 'dsh-editor-seats/seat-button'
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
import { TextPromptDialog } from './dialog.tsx'
import { renderSelect } from './host-ui.tsx'
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

/* 活动暗示:三点呼吸(pulse-dots)与骨架行(fluid-skeleton),参数改写自
   Amicro(MIT License, Copyright (c) 2026 Syed Subhan Uddin);装饰 aria-hidden,
   关键帧在 styles.ts,reduced-motion 停循环后保留静态可读态。 */
const activityDots = () => <span className="panel-activity-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>
const skeletonRows = (widths: readonly string[]) => <span className="panel-skeleton" aria-hidden="true">
  {widths.map((width, index) => <i key={index} style={{ width }} />)}
</span>

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
  return <CardsPanel {...props} kind={store.kind} selectedPath={store.selectedPath} />;
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
  const tablistRef = useRef<HTMLDivElement | null>(null)
  /* 页签键盘导航:漫游 tabindex(仅选中页签可 Tab 聚焦),方向键左右循环移动,Home/End 跳首尾,移动即激活。 */
  const onCardsTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    const tabs = Array.from(tablistRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])
    if (!tabs.length) return
    event.preventDefault()
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    const last = tabs.length - 1
    let next = 0
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'End') next = last
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  return (
    <section className="cards-panel" data-testid="cards-panel" aria-label={title}>
      <header className="cards-panel-header">
        <h2>
          {title}
        </h2>
        <SeatButton
          host={props.Button}
          variant="icon"
          className="icon-button"
          aria-label={t('cards.closePanel')}
          onClick={() => closeCardsPanel()}>
          ×
        </SeatButton>
      </header>
      <div
        className="cards-tabs"
        role="tablist"
        aria-label={t('cards.kind')}
        ref={tablistRef}
        onKeyDown={onCardsTabsKeyDown}>
        <button
          type="button"
          role="tab"
          tabIndex={props.kind === 'character' ? 0 : -1}
          aria-selected={props.kind === 'character'}
          onClick={() => openCardsPanel('character')}>
          {t('cards.person')}
        </button>
        <button
          type="button"
          role="tab"
          tabIndex={props.kind === 'worldbook' ? 0 : -1}
          aria-selected={props.kind === 'worldbook'}
          onClick={() => openCardsPanel('worldbook')}>
          {t('cards.setting')}
        </button>
      </div>
      <div className="cards-toolbar">
        <input
          value={text}
          maxLength={80}
          placeholder={props.kind === 'character' ? t('cards.filterPeople') : t('cards.filterWorld')}
          aria-label={t('cards.filter')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)} />
        {renderSelect(props.Select, {
          value: sort,
          'aria-label': t('cards.sort'),
          options: sortOptions,
          onChange: (next) => {
            if (next === 'title' || next === 'modified' || next === 'role' || next === 'category') setSort(next)
          },
        })}
        <SeatButton host={props.Button} onClick={() => { setCreateNote(''); setCreateOpen(true) }}>
          {props.kind === 'character' ? t('cards.newPerson') : t('cards.newSetting')}
        </SeatButton>
      </div>
      {roleOptions.length && props.kind === 'character' ? <ChipRow
        label={t('cards.role')}
        values={roleOptions}
        selected={roleChips}
        onToggle={(value) => setRoleChips((old) => toggleFilterValue(old, value))}
        display={(value) => value === UNGROUPED_ROLE ? ungroupedRoleLabel() : value}
        hostButton={props.Button} /> : null}
      {categoryOptions.length && props.kind === 'worldbook' ? <ChipRow
        label={t('cards.category')}
        values={categoryOptions}
        selected={categoryChips}
        onToggle={(value) => setCategoryChips((old) => toggleFilterValue(old, value))}
        display={worldbookCategoryLabel}
        hostButton={props.Button} /> : null}
      {tagOptions.length ? <ChipRow
        label={t('cards.tags')}
        values={tagOptions}
        selected={tagChips}
        onToggle={(value) => setTagChips((old) => toggleFilterValue(old, value))}
        hostButton={props.Button} /> : null}
      {busy ? <div className="cards-status cards-loading" role="status">
        {skeletonRows(['100%', '88%', '96%', '72%'])}
        <span className="sr-only">
          {t('cards.loading')}
        </span>
      </div> : null}
      {note ? <p
        className={`cards-status ${truncated ? 'warning' : 'muted'}`}
        role={note && !truncated && !busy ? 'alert' : 'status'}>
        {note}
        {!busy && !truncated && note && !list.length ? <SeatButton host={props.Button} onClick={() => void load()}>
          {t('cards.retry')}
        </SeatButton> : null}
      </p> : null}
      {!busy && !list.length && !(note && !truncated) ? <p className="cards-status muted">
        {emptyLabel}
      </p> : null}
      {props.kind === 'character' && characterGroups.length
        ? <div className="cards-groups">
        {characterGroups.map((group) => <section key={group.key} className="cards-group">
          <h3>
            {group.key === UNGROUPED_ROLE ? ungroupedRoleLabel() : group.label}
          </h3>
          <ul className="cards-list">
            {group.cards.map((card) => <CharacterCardRow
              key={card.path}
              card={card}
              selected={props.selectedPath === card.path}
              refs={refs[card.path] ?? { status: 'idle' }}
              navigationBlocked={props.editorDirty}
              onSelect={() => selectCard(card.path)}
              onReferences={() => void loadReferences(card.path)}
              onOpenHit={(item) => void openHit(item)}
              hostButton={props.Button} />)}
          </ul>
        </section>)}
      </div>
        : null}
      {props.kind === 'worldbook' && worldbookGroups.length
        ? <div className="cards-groups">
        {worldbookGroups.map((group) => <section key={group.key} className="cards-group">
          <h3>
            {worldbookCategoryLabel(group.key)}
          </h3>
          <ul className="cards-list">
            {group.cards.map((card) => <WorldbookCardRow
              key={card.path}
              card={card}
              selected={props.selectedPath === card.path}
              refs={refs[card.path] ?? { status: 'idle' }}
              navigationBlocked={props.editorDirty}
              onSelect={() => selectCard(card.path)}
              onReferences={() => void loadReferences(card.path)}
              onOpenHit={(item) => void openHit(item)}
              hostButton={props.Button} />)}
          </ul>
        </section>)}
      </div>
        : null}
      <TextPromptDialog
        Dialog={props.Dialog}
        Button={props.Button}
        id="cards-create"
        open={createOpen}
        title={props.kind === 'character' ? t('cards.newPerson') : t('cards.newSetting')}
        label={t('cards.title')}
        initialValue=""
        confirmLabel={t('common.create')}
        busy={createBusy}
        note={createNote}
        onCancel={() => { if (!createBusy) setCreateOpen(false) }}
        onConfirm={(nextTitle: string) => void createCard(nextTitle)} />
    </section>
  );
}

function ChipRow(props: {
  label: string
  values: readonly string[]
  selected: readonly string[]
  onToggle(value: string): void
  display?(value: string): string
  hostButton?: ShellToolSeatContext['Button']
}) {
  return (
    <div className="cards-chips" aria-label={props.label}>
      {props.values.map((value) => <SeatButton
        host={props.hostButton}
        key={value}
        className="cards-chip"
        aria-pressed={props.selected.includes(value)}
        onClick={() => props.onToggle(value)}>
        {props.display?.(value) ?? value}
      </SeatButton>)}
    </div>
  );
}

function CharacterCardRow(props: {
  card: CharacterCard
  selected: boolean
  refs: ReferenceState
  navigationBlocked: boolean
  onSelect(): void
  onReferences(): void
  onOpenHit(hit: CardReferenceHit): void
  hostButton?: ShellToolSeatContext['Button']
}) {
  const { card } = props
  const fields = card.frontmatter
  return (
    <li className={`cards-item${props.selected ? ' selected' : ''}`}>
      <SeatButton
        host={props.hostButton}
        className="cards-item-main"
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}>
        <strong>
          {card.title}
        </strong>
        <span className="cards-meta">
          {fields.role ? <em className="cards-badge">
            {fields.role}
          </em> : null}
          {fields.faction ? <span>
            {fields.faction}
          </span> : null}
          {fields.status ? <span>
            {fields.status}
          </span> : null}
        </span>
        {fields.tags?.length ? <span className="cards-tags">
          {fields.tags.join(' · ')}
        </span> : null}
        {card.summary ? <small>
          {card.summary}
        </small> : null}
      </SeatButton>
      <ReferenceBlock
        state={props.refs}
        navigationBlocked={props.navigationBlocked}
        onRequest={props.onReferences}
        onOpenHit={props.onOpenHit}
        hostButton={props.hostButton} />
    </li>
  );
}

function WorldbookCardRow(props: {
  card: WorldbookCard
  selected: boolean
  refs: ReferenceState
  navigationBlocked: boolean
  onSelect(): void
  onReferences(): void
  onOpenHit(hit: CardReferenceHit): void
  hostButton?: ShellToolSeatContext['Button']
}) {
  const { card } = props
  const fields = card.frontmatter
  return (
    <li className={`cards-item${props.selected ? ' selected' : ''}`}>
      <SeatButton
        host={props.hostButton}
        className="cards-item-main"
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}>
        <strong>
          {card.title}
        </strong>
        <span className="cards-meta">
          {fields.category ? <em className="cards-badge">
            {worldbookCategoryLabel(fields.category)}
          </em> : null}
        </span>
        {fields.tags?.length ? <span className="cards-tags">
          {fields.tags.join(' · ')}
        </span> : null}
        {card.summary ? <small>
          {card.summary}
        </small> : null}
      </SeatButton>
      <ReferenceBlock
        state={props.refs}
        navigationBlocked={props.navigationBlocked}
        onRequest={props.onReferences}
        onOpenHit={props.onOpenHit}
        hostButton={props.hostButton} />
    </li>
  );
}

export function ReferenceBlock(props: {
  state: ReferenceState
  navigationBlocked: boolean
  onRequest(): void
  onOpenHit(hit: CardReferenceHit): void
  hostButton?: ShellToolSeatContext['Button']
}) {
  const label = props.state.status === 'ready'
    ? t('cards.refCount', { count: props.state.value.hits.length })
    : props.state.status === 'busy' ? <Fragment>
    {activityDots()}
    {t('cards.refsEllipsis')}
  </Fragment> : t('cards.refs')
  return (
    <div className="cards-refs">
      <SeatButton
        host={props.hostButton}
        className="cards-ref-toggle"
        disabled={props.state.status === 'busy'}
        onClick={props.onRequest}>
        {label}
      </SeatButton>
      {props.state.status === 'error' ? <p className="muted">
        {props.state.note}
      </p> : null}
      {props.state.status === 'ready' ? <ReferenceGroups
        hits={props.state.value.hits}
        truncated={props.state.value.truncated}
        navigationBlocked={props.navigationBlocked}
        onOpenHit={props.onOpenHit}
        hostButton={props.hostButton} /> : null}
    </div>
  );
}

export function ReferenceGroups(props: {
  hits: readonly CardReferenceHit[]
  truncated?: boolean
  navigationBlocked: boolean
  onOpenHit(hit: CardReferenceHit): void
  hostButton?: ShellToolSeatContext['Button']
}) {
  const grouped = groupReferencesByChapter(props.hits)
  if (!grouped.length) return (
    <p className="muted">
      {t('cards.noRefs')}
    </p>
  );
  return (
    <div className="cards-ref-groups">
      {props.truncated ? <p className="warning">
        {t('cards.refsCapped')}
      </p> : null}
      <ol>
        {grouped.map((group) => <li key={group.path}>
          <strong>
            {group.title}
          </strong>
          <ul>
            {group.hits.map((item, index) => <li key={`${item.path}:${item.start}:${index}`}>
              <SeatButton
                host={props.hostButton}
                disabled={props.navigationBlocked}
                onClick={() => props.onOpenHit(item)}>
                {t('cards.refLine', { line: item.line, excerpt: item.excerpt })}
              </SeatButton>
            </li>)}
          </ul>
        </li>)}
      </ol>
    </div>
  );
}
