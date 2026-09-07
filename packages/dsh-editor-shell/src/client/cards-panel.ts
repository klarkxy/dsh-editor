import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  WORKBENCH_RPC_CHANNEL,
  formatWorldbookTriggerLines,
  parseWorldbookTriggerLines,
  type CardKind,
  type CardReferenceHit,
  type CardsCreateResponse,
  type CardsListResponse,
  type CardsMetaSetResponse,
  type CardsReferencesResponse,
  type CharacterCard,
  type CharacterCardFields,
  type WorldbookCard,
  type WorldbookCardFields,
} from 'dsh-editor-workbench/contracts'
import {
  UNGROUPED_ROLE,
  WORLDBOOK_CATEGORIES,
  collectCharacterRoles,
  collectTags,
  collectWorldbookCategories,
  formatListInput,
  groupCharacterCards,
  groupReferencesByChapter,
  groupWorldbookCards,
  parseListInput,
  resolveRelationTarget,
  toggleFilterValue,
  visibleCharacterCards,
  visibleWorldbookCards,
  ungroupedRoleLabel,
  worldbookCategoryLabel,
  worldbookCategoryValue,
  type CardSortKey,
} from '../cards-view.ts'
import { TextPromptDialog } from './dialogs.ts'
import { errorMessage, isStaleFailure, LatestRequestGate, safeRpcCall, type ShellContext } from './shared.ts'
import type { SearchHit } from './search-panel.ts'
import { t } from '../i18n/index.ts'

export type CardsCatalog = { characters: CharacterCard[]; worldbook: WorldbookCard[] }

const EMPTY_CATALOG: CardsCatalog = { characters: [], worldbook: [] }

type ReferenceState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'error'; note: string }
  | { status: 'ready'; value: CardsReferencesResponse }

function emptyRefs(): Record<string, ReferenceState> {
  return {}
}

function CardsPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  kind: CardKind
  selectedPath: string | null
  navigationBlocked: boolean
  onKindChange(kind: CardKind): void
  onSelect(path: string | null): void
  onCatalog(catalog: CardsCatalog): void
  onCreated(path: string): void
  onOpenHit(hit: SearchHit): void
}) {
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
  const requestScope = `${props.sessionId}\u0000${props.revision}`
  requestGate.setScope(requestScope)

  const load = async () => {
    const ticket = requestGate.begin(requestScope)
    setBusy(true)
    setNote('')
    const listed = await safeRpcCall<CardsListResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'cards.list', {
      sessionId: props.sessionId,
      kind: 'all',
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!listed.ok) {
      setCatalog(EMPTY_CATALOG)
      props.onCatalog(EMPTY_CATALOG)
      setNote(errorMessage(listed))
      setTruncated(false)
      return
    }
    const next = { characters: listed.value.characters, worldbook: listed.value.worldbook }
    setCatalog(next)
    props.onCatalog(next)
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
  }, [props.sessionId, props.revision])

  const openHit = async (hit: CardReferenceHit) => {
    if (props.navigationBlocked) return
    const read = await safeRpcCall<{ version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: hit.path,
    }))
    if (!read.ok) { setNote(errorMessage(read)); return }
    props.onOpenHit({ ...hit, version: read.value.version })
  }

  const loadReferences = async (path: string) => {
    const current = refs[path]
    if (current?.status === 'busy') return
    setRefs((old) => ({ ...old, [path]: { status: 'busy' } }))
    const result = await safeRpcCall<CardsReferencesResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'cards.references', {
      sessionId: props.sessionId,
      path,
    }))
    setRefs((old) => ({
      ...old,
      [path]: result.ok ? { status: 'ready', value: result.value } : { status: 'error', note: errorMessage(result) },
    }))
  }

  const createCard = async (title: string) => {
    if (createBusy) return
    setCreateBusy(true)
    setCreateNote('')
    const created = await safeRpcCall<CardsCreateResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'cards.create', {
      sessionId: props.sessionId,
      kind: props.kind,
      title,
    }))
    setCreateBusy(false)
    if (!created.ok) { setCreateNote(errorMessage(created)); return }
    setCreateOpen(false)
    setCreateNote('')
    props.onCreated(created.value.path)
  }

  const characters = visibleCharacterCards(catalog.characters, { text, roles: roleChips, tags: tagChips, sort })
  const worldbook = visibleWorldbookCards(catalog.worldbook, { text, categories: categoryChips, tags: tagChips, sort })
  const characterGroups = groupCharacterCards(characters)
  const worldbookGroups = groupWorldbookCards(worldbook)
  const roleOptions = collectCharacterRoles(catalog.characters)
  const categoryOptions = collectWorldbookCategories(catalog.worldbook)
  const tagOptions = collectTags(props.kind === 'character' ? catalog.characters : catalog.worldbook)
  return e('section', { className: 'cards-panel', 'aria-label': props.kind === 'character' ? t('cards.characters') : t('cards.worldbook') },
    e('div', { className: 'cards-tabs', role: 'tablist', 'aria-label': t('cards.kind') },
      e('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': props.kind === 'character',
        onClick: () => props.onKindChange('character'),
      }, t('cards.person')),
      e('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': props.kind === 'worldbook',
        onClick: () => props.onKindChange('worldbook'),
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
      e('select', {
        value: sort,
        'aria-label': t('cards.sort'),
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const next = event.target.value
          if (next === 'title' || next === 'modified' || next === 'role' || next === 'category') setSort(next)
        },
      },
        e('option', { value: 'title' }, t('cards.sortName')),
        e('option', { value: 'modified' }, t('cards.sortModified')),
        props.kind === 'character' ? e('option', { value: 'role' }, t('cards.sortRole')) : e('option', { value: 'category' }, t('cards.sortCategory')),
      ),
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
    busy ? e('p', { className: 'muted', role: 'status' }, t('cards.loading')) : null,
    note ? e('p', { className: truncated ? 'warning' : 'muted', role: 'status' }, note) : null,
    props.kind === 'character'
      ? characterGroups.length
        ? e('div', { className: 'cards-groups' }, characterGroups.map((group) => e('section', { key: group.key, className: 'cards-group' },
          e('h3', null, group.key === UNGROUPED_ROLE ? ungroupedRoleLabel() : group.label),
          e('ul', { className: 'cards-list' }, group.cards.map((card) => e(CharacterCardRow, {
            key: card.path,
            card,
            selected: props.selectedPath === card.path,
            refs: refs[card.path] ?? { status: 'idle' },
            navigationBlocked: props.navigationBlocked,
            onSelect: () => props.onSelect(card.path),
            onReferences: () => void loadReferences(card.path),
            onOpenHit: (item) => void openHit(item),
          }))),
        )))
        : e('p', { className: 'muted' }, busy ? null : t('cards.noPeople'))
      : worldbookGroups.length
        ? e('div', { className: 'cards-groups' }, worldbookGroups.map((group) => e('section', { key: group.key, className: 'cards-group' },
          e('h3', null, worldbookCategoryLabel(group.key)),
          e('ul', { className: 'cards-list' }, group.cards.map((card) => e(WorldbookCardRow, {
            key: card.path,
            card,
            selected: props.selectedPath === card.path,
            refs: refs[card.path] ?? { status: 'idle' },
            navigationBlocked: props.navigationBlocked,
            onSelect: () => props.onSelect(card.path),
            onReferences: () => void loadReferences(card.path),
            onOpenHit: (item) => void openHit(item),
          }))),
        )))
        : e('p', { className: 'muted' }, busy ? null : t('cards.noWorld')),
    createOpen ? e(TextPromptDialog, {
      id: 'cards-create',
      title: props.kind === 'character' ? t('cards.newPerson') : t('cards.newSetting'),
      label: t('cards.title'),
      initialValue: '',
      confirmLabel: t('common.create'),
      busy: createBusy,
      note: createNote,
      onCancel: () => { if (!createBusy) setCreateOpen(false) },
      onConfirm: (title: string) => void createCard(title),
    }) : null,
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
        e('span', null, fields.enabled === false ? t('common.disable') : t('common.enable')),
        typeof fields.priority === 'number' ? e('span', null, t('cards.priority', { value: fields.priority })) : null,
      ),
      fields.tags?.length ? e('span', { className: 'cards-tags' }, fields.tags.join(' · ')) : null,
      card.summary ? e('small', null, card.summary) : null,
    ),
    e(ReferenceBlock, { state: props.refs, navigationBlocked: props.navigationBlocked, onRequest: props.onReferences, onOpenHit: props.onOpenHit }),
  )
}

function ReferenceBlock(props: {
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

function ReferenceGroups(props: {
  hits: readonly CardReferenceHit[]
  truncated?: boolean
  navigationBlocked: boolean
  onOpenHit(hit: CardReferenceHit): void
}) {
  const grouped = groupReferencesByChapter(props.hits)
  if (!grouped.length) return e('p', { className: 'muted' }, t('cards.noRefs'))
  return e('div', { className: 'cards-ref-groups' },
    props.truncated ? e('p', { className: 'warning' }, t('cards.refsCapped')) : null,
    e('ol', null, grouped.map((group) => e('li', { key: group.path },
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

function CardsDetail(props: {
  ctx: ShellContext
  sessionId: string
  kind: CardKind
  card: CharacterCard | WorldbookCard
  characters: readonly CharacterCard[]
  navigationBlocked: boolean
  onClose(): void
  onOpenDocument(path: string): void
  onSelectCard(path: string): void
  onChanged(): void
  onOpenHit(hit: SearchHit): void
  pinnedPath: string | null
  onTogglePin(path: string): void
}) {
  const card = props.card
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [references, setReferences] = useState<ReferenceState>({ status: 'idle' })
  const isCharacter = props.kind === 'character'
  const character = isCharacter ? card as CharacterCard : null
  const worldbook = isCharacter ? null : card as WorldbookCard
  const [name, setName] = useState(character?.frontmatter.name ?? card.title)
  const [aliases, setAliases] = useState(formatListInput(character?.frontmatter.aliases))
  const [role, setRole] = useState(character?.frontmatter.role ?? '')
  const [gender, setGender] = useState(character?.frontmatter.gender ?? '')
  const [age, setAge] = useState(character?.frontmatter.age ?? '')
  const [faction, setFaction] = useState(character?.frontmatter.faction ?? '')
  const [status, setStatus] = useState(character?.frontmatter.status ?? '')
  const [tags, setTags] = useState(formatListInput(card.frontmatter.tags))
  const [summary, setSummary] = useState(card.frontmatter.summary ?? card.summary)
  const [relations, setRelations] = useState<{ to: string; kind: string }[]>(character?.frontmatter.relations?.length ? character.frontmatter.relations.map((row) => ({ ...row })) : [])
  const [triggers, setTriggers] = useState(formatWorldbookTriggerLines(worldbook?.frontmatter.triggers ?? []))
  const [enabled, setEnabled] = useState(worldbook?.frontmatter.enabled !== false)
  const [priority, setPriority] = useState(String(worldbook?.frontmatter.priority ?? 0))
  const categoryCurrent = worldbook?.frontmatter.category ?? ''
  const categoryPreset = WORLDBOOK_CATEGORIES.includes(categoryCurrent as typeof WORLDBOOK_CATEGORIES[number]) || !categoryCurrent
  const [category, setCategory] = useState(categoryPreset ? categoryCurrent : '__custom__')
  const [categoryCustom, setCategoryCustom] = useState(categoryPreset ? '' : categoryCurrent)

  useEffect(() => {
    const nextCharacter = props.kind === 'character' ? props.card as CharacterCard : null
    const nextWorldbook = props.kind === 'character' ? null : props.card as WorldbookCard
    setNote('')
    setName(nextCharacter?.frontmatter.name ?? props.card.title)
    setAliases(formatListInput(nextCharacter?.frontmatter.aliases))
    setRole(nextCharacter?.frontmatter.role ?? '')
    setGender(nextCharacter?.frontmatter.gender ?? '')
    setAge(nextCharacter?.frontmatter.age ?? '')
    setFaction(nextCharacter?.frontmatter.faction ?? '')
    setStatus(nextCharacter?.frontmatter.status ?? '')
    setTags(formatListInput(props.card.frontmatter.tags))
    setSummary(props.card.frontmatter.summary ?? props.card.summary)
    setRelations(nextCharacter?.frontmatter.relations?.map((row) => ({ ...row })) ?? [])
    setTriggers(formatWorldbookTriggerLines(nextWorldbook?.frontmatter.triggers ?? []))
    setEnabled(nextWorldbook?.frontmatter.enabled !== false)
    setPriority(String(nextWorldbook?.frontmatter.priority ?? 0))
    const nextCategory = nextWorldbook?.frontmatter.category ?? ''
    const preset = WORLDBOOK_CATEGORIES.includes(nextCategory as typeof WORLDBOOK_CATEGORIES[number]) || !nextCategory
    setCategory(preset ? nextCategory : '__custom__')
    setCategoryCustom(preset ? '' : nextCategory)
    setReferences({ status: 'idle' })
  }, [props.card.path, props.card.version, props.kind])

  const openHit = async (hit: CardReferenceHit) => {
    if (props.navigationBlocked) return
    const read = await safeRpcCall<{ version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: hit.path,
    }))
    if (!read.ok) { setNote(errorMessage(read)); return }
    props.onOpenHit({ ...hit, version: read.value.version })
  }

  const loadReferences = async () => {
    if (references.status === 'busy') return
    setReferences({ status: 'busy' })
    const result = await safeRpcCall<CardsReferencesResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'cards.references', {
      sessionId: props.sessionId,
      path: card.path,
    }))
    setReferences(result.ok ? { status: 'ready', value: result.value } : { status: 'error', note: errorMessage(result) })
  }

  const save = async () => {
    if (busy) return
    let fields: Partial<CharacterCardFields & WorldbookCardFields>
    if (isCharacter) {
      fields = {
        name,
        aliases: parseListInput(aliases),
        role,
        gender,
        age,
        faction,
        status,
        tags: parseListInput(tags),
        relations: relations
          .map((row) => ({ to: row.to.trim(), kind: row.kind.trim() }))
          .filter((row) => row.to && row.kind),
        summary,
      }
    } else {
      const values = parseWorldbookTriggerLines(triggers)
      const numericPriority = Number(priority)
      if (!values.length) { setNote(t('cards.needTrigger')); return }
      if (values.length > 16 || values.some((value) => value.length > 64 || /[\u0000-\u001f\u007f]/.test(value))) {
        setNote(t('cards.triggerLimit'))
        return
      }
      if (!/^-?\d+$/.test(priority.trim()) || !Number.isSafeInteger(numericPriority) || numericPriority < -100 || numericPriority > 100) {
        setNote(t('cards.priorityRange'))
        return
      }
      fields = {
        triggers: values,
        enabled,
        priority: numericPriority,
        category: worldbookCategoryValue(category, categoryCustom),
        tags: parseListInput(tags),
        summary,
      }
    }
    setBusy(true)
    setNote('')
    const saved = await safeRpcCall<CardsMetaSetResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'cards.metaSet', {
      sessionId: props.sessionId,
      path: card.path,
      version: card.version,
      fields,
    }))
    setBusy(false)
    if (!saved.ok) {
      setNote(isStaleFailure(saved) ? t('cards.staleReread') : errorMessage(saved))
      props.onChanged()
      return
    }
    setNote(t('cards.saved'))
    props.onChanged()
  }

  return e('section', { className: 'cards-detail', 'aria-label': isCharacter ? t('cards.personDetail') : t('cards.worldDetail') },
    e('header', { className: 'cards-detail-header' },
      e('div', null,
        e('h2', null, card.title),
        e('p', { className: 'muted' }, card.path),
      ),
      e('div', { className: 'cards-detail-header-actions' },
        e('button', {
          type: 'button',
          'aria-pressed': props.pinnedPath === card.path,
          onClick: () => props.onTogglePin(card.path),
        }, props.pinnedPath === card.path ? t('pin.unpin') : t('pin.beside')),
        e('button', { className: 'icon-button', type: 'button', 'aria-label': t('cards.closeDetail'), onClick: props.onClose }, '×'),
      ),
    ),
    e('div', { className: 'cards-detail-body' },
      isCharacter ? e('div', { className: 'cards-fields' },
        field(t('cards.name'), e('input', { value: name, onChange: (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value), 'aria-label': t('cards.name') })),
        field(t('cards.aliases'), e('input', { value: aliases, onChange: (event: ChangeEvent<HTMLInputElement>) => setAliases(event.target.value), 'aria-label': t('cards.aliases'), placeholder: t('cards.commaSep') })),
        field(t('cards.role'), e('input', { value: role, onChange: (event: ChangeEvent<HTMLInputElement>) => setRole(event.target.value), 'aria-label': t('cards.role') })),
        field(t('cards.gender'), e('input', { value: gender, onChange: (event: ChangeEvent<HTMLInputElement>) => setGender(event.target.value), 'aria-label': t('cards.gender') })),
        field(t('cards.age'), e('input', { value: age, onChange: (event: ChangeEvent<HTMLInputElement>) => setAge(event.target.value), 'aria-label': t('cards.age') })),
        field(t('cards.faction'), e('input', { value: faction, onChange: (event: ChangeEvent<HTMLInputElement>) => setFaction(event.target.value), 'aria-label': t('cards.faction') })),
        field(t('cards.status'), e('input', { value: status, onChange: (event: ChangeEvent<HTMLInputElement>) => setStatus(event.target.value), 'aria-label': t('cards.status') })),
        field(t('cards.tags'), e('input', { value: tags, onChange: (event: ChangeEvent<HTMLInputElement>) => setTags(event.target.value), 'aria-label': t('cards.tags'), placeholder: t('cards.commaSep') })),
        e('label', { className: 'cards-field cards-field-wide' }, e('span', null, t('cards.relations')),
          e('div', { className: 'cards-relations' },
            relations.map((row, index) => {
              const target = resolveRelationTarget(row.to, props.characters)
              return e('div', { key: `${index}:${row.to}`, className: 'cards-relation-row' },
                e('input', {
                  value: row.to,
                  placeholder: t('cards.relationTo'),
                  'aria-label': t('cards.relationToAria', { n: index + 1 }),
                  onChange: (event: ChangeEvent<HTMLInputElement>) => setRelations((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, to: event.target.value } : item)),
                }),
                target ? e('button', { type: 'button', className: 'cards-relation-link', onClick: () => props.onSelectCard(target.path) }, target.title) : null,
                e('input', {
                  value: row.kind,
                  placeholder: t('cards.relations'),
                  'aria-label': t('cards.relationKindAria', { n: index + 1 }),
                  onChange: (event: ChangeEvent<HTMLInputElement>) => setRelations((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value } : item)),
                }),
                e('button', { type: 'button', onClick: () => setRelations((old) => old.filter((_, itemIndex) => itemIndex !== index)) }, t('cards.removeShort')),
              )
            }),
            e('button', { type: 'button', onClick: () => setRelations((old) => [...old, { to: '', kind: '' }]) }, t('cards.addRelation')),
          ),
        ),
        field(t('cards.summary'), e('textarea', { value: summary, rows: 3, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSummary(event.target.value), 'aria-label': t('cards.summary') }), true),
      ) : e('div', { className: 'cards-fields' },
        field(t('cards.triggers'), e('textarea', {
          value: triggers,
          rows: Math.min(4, Math.max(2, triggers.split(/\r?\n/).length)),
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setTriggers(event.target.value),
          'aria-label': t('cards.triggersAria'),
        }), true),
        e('label', { className: 'cards-field cards-enabled' },
          e('input', { type: 'checkbox', checked: enabled, onChange: (event: ChangeEvent<HTMLInputElement>) => setEnabled(event.target.checked) }),
          e('span', null, t('common.enable')),
        ),
        field(t('cards.priorityField'), e('input', {
          type: 'number',
          min: -100,
          max: 100,
          step: 1,
          value: priority,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setPriority(event.target.value),
          'aria-label': t('cards.priorityAria'),
        })),
        field(t('cards.category'), e('select', {
          value: category,
          'aria-label': t('cards.categoryAria'),
          onChange: (event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value),
        },
          e('option', { value: '' }, t('cards.uncategorized')),
          WORLDBOOK_CATEGORIES.map((item) => e('option', { key: item, value: item }, worldbookCategoryLabel(item))),
          e('option', { value: '__custom__' }, t('common.custom')),
        )),
        category === '__custom__' ? field(t('cards.customCategory'), e('input', {
          value: categoryCustom,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setCategoryCustom(event.target.value),
          'aria-label': t('cards.customCategory'),
        })) : null,
        field(t('cards.tags'), e('input', { value: tags, onChange: (event: ChangeEvent<HTMLInputElement>) => setTags(event.target.value), 'aria-label': t('cards.tags'), placeholder: t('cards.commaSep') })),
        field(t('cards.summary'), e('textarea', { value: summary, rows: 3, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSummary(event.target.value), 'aria-label': t('cards.summary') }), true),
      ),
      e('div', { className: 'cards-detail-actions' },
        e('button', { type: 'button', disabled: busy, onClick: () => void save() }, busy ? t('common.saving') : t('common.save')),
        e('button', { type: 'button', disabled: props.navigationBlocked, onClick: () => props.onOpenDocument(card.path) }, t('cards.openDoc')),
        e('button', { type: 'button', disabled: references.status === 'busy', onClick: () => void loadReferences() }, references.status === 'ready' ? t('cards.refCount', { count: references.value.hits.length }) : t('cards.refs')),
      ),
      note ? e('p', { className: /已保存|已重新读取|saved|re-?read/i.test(note) ? 'muted' : 'warning', role: 'status' }, note) : null,
      props.navigationBlocked ? e('p', { className: 'warning' }, t('cards.saveBeforeRef')) : null,
      references.status === 'error' ? e('p', { className: 'warning' }, references.note) : null,
      references.status === 'ready' ? e(ReferenceGroups, {
        hits: references.value.hits,
        truncated: references.value.truncated,
        navigationBlocked: props.navigationBlocked,
        onOpenHit: (item) => void openHit(item),
      }) : null,
    ),
  )
}

function field(label: string, control: ReactNode, wide = false) {
  return e('label', { className: `cards-field${wide ? ' cards-field-wide' : ''}` }, e('span', null, label), control)
}

export { CardsPanel, CardsDetail }
