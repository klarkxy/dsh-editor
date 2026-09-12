import { createElement as e, useEffect, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react'
import {
  CARDS_RPC_CHANNEL,
  type CardKind,
  type CardReferenceHit,
  type CardsMetaSetResponse,
  type CardsReferencesResponse,
  type CharacterCard,
  type CharacterCardFields,
  type WorldbookCard,
  type WorldbookCardFields,
} from '../contracts.ts'
import { CENTER_OVERLAY_ATTRIBUTE, type ShellRange } from 'dsh-editor-seats'
import { renderSelect } from './host-ui.ts'
import {
  WORLDBOOK_CATEGORIES,
  formatListInput,
  parseListInput,
  resolveRelationTarget,
  worldbookCategoryLabel,
  worldbookCategoryValue,
} from '../cards-view.ts'
import { errorMessage, isStaleFailure, safeRpcCall } from './rpc.ts'
import { setCardsLocale, t } from './messages.ts'
import { closeCardsDetail, getCardsState, selectCard, subscribeCardsStore } from './store.ts'
import { ReferenceGroups, type CardsSeatProps, type ReferenceState } from './panel.ts'

export function CardsDetailSeat(props: CardsSeatProps) {
  setCardsLocale(props.locale)
  const store = useSyncExternalStore(subscribeCardsStore, getCardsState, getCardsState)
  if (!store.open || !store.selectedPath || !props.sessionId) return null
  const card = store.kind === 'character'
    ? store.catalog.characters.find((item) => item.path === store.selectedPath)
    : store.catalog.worldbook.find((item) => item.path === store.selectedPath)
  if (!card) return null
  return e(CardsDetail, {
    ...props,
    kind: store.kind,
    card,
    characters: store.catalog.characters,
  })
}

function CardsDetail(props: CardsSeatProps & {
  kind: CardKind
  card: CharacterCard | WorldbookCard
  characters: readonly CharacterCard[]
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
    const nextCategory = nextWorldbook?.frontmatter.category ?? ''
    const preset = WORLDBOOK_CATEGORIES.includes(nextCategory as typeof WORLDBOOK_CATEGORIES[number]) || !nextCategory
    setCategory(preset ? nextCategory : '__custom__')
    setCategoryCustom(preset ? '' : nextCategory)
    setReferences({ status: 'idle' })
  }, [props.card.path, props.card.version, props.kind])

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

  const loadReferences = async () => {
    if (references.status === 'busy') return
    setReferences({ status: 'busy' })
    const result = await safeRpcCall<CardsReferencesResponse>(() => props.rpc.call(CARDS_RPC_CHANNEL, 'cards.references', {
      sessionId: props.sessionId,
      path: card.path,
    }))
    setReferences(result.ok ? { status: 'ready', value: result.value } : { status: 'error', note: errorMessage(result, props.locale) })
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
      fields = {
        category: worldbookCategoryValue(category, categoryCustom),
        tags: parseListInput(tags),
        summary,
      }
    }
    setBusy(true)
    setNote('')
    const saved = await safeRpcCall<CardsMetaSetResponse>(() => props.rpc.call(CARDS_RPC_CHANNEL, 'cards.metaSet', {
      sessionId: props.sessionId,
      path: card.path,
      version: card.version,
      fields,
    }))
    setBusy(false)
    if (!saved.ok) {
      setNote(isStaleFailure(saved) ? t('cards.staleReread') : errorMessage(saved, props.locale))
      props.refresh('tree')
      return
    }
    setNote(t('cards.saved'))
    props.refresh('tree')
  }

  return e('section', { className: 'cards-detail', [CENTER_OVERLAY_ATTRIBUTE]: '', 'data-testid': 'cards-detail', 'aria-label': isCharacter ? t('cards.personDetail') : t('cards.worldDetail') },
    e('header', { className: 'cards-detail-header' },
      e('div', null,
        e('h2', null, card.title),
        e('p', { className: 'muted' }, card.path),
      ),
      e('div', { className: 'cards-detail-header-actions' },
        e('button', { type: 'button', onClick: () => closeCardsDetail() }, t('cards.back')),
        e('button', {
          type: 'button',
          'aria-pressed': props.pinnedPath === card.path,
          onClick: () => props.togglePin(card.path),
        }, props.pinnedPath === card.path ? t('pin.unpin') : t('pin.beside')),
        e('button', { className: 'icon-button', type: 'button', 'aria-label': t('cards.closeDetail'), onClick: () => closeCardsDetail() }, '×'),
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
                target ? e('button', { type: 'button', className: 'cards-relation-link', onClick: () => selectCard(target.path) }, target.title) : null,
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
        field(t('cards.category'), renderSelect(props.Select, {
          value: category,
          'aria-label': t('cards.categoryAria'),
          onChange: (next) => setCategory(next),
          options: [
            { value: '', label: t('cards.uncategorized') },
            ...WORLDBOOK_CATEGORIES.map((item) => ({ value: item, label: worldbookCategoryLabel(item) })),
            { value: '__custom__', label: t('common.custom') },
          ],
        })),
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
        e('button', { type: 'button', disabled: props.editorDirty, onClick: () => {
          props.expandTreePath(card.path)
          props.openDocument(card.path)
        } }, t('cards.openDoc')),
        e('button', { type: 'button', disabled: references.status === 'busy', onClick: () => void loadReferences() }, references.status === 'ready' ? t('cards.refCount', { count: references.value.hits.length }) : t('cards.refs')),
      ),
      note ? e('p', { className: /已保存|已重新读取|saved|re-?read/i.test(note) ? 'muted' : 'warning', role: 'status' }, note) : null,
      props.editorDirty ? e('p', { className: 'warning' }, t('cards.saveBeforeRef')) : null,
      references.status === 'error' ? e('p', { className: 'warning' }, references.note) : null,
      references.status === 'ready' ? e(ReferenceGroups, {
        hits: references.value.hits,
        truncated: references.value.truncated,
        navigationBlocked: props.editorDirty,
        onOpenHit: (item) => void openHit(item),
      }) : null,
    ),
  )
}

function field(label: string, control: ReactNode, wide = false) {
  return e('label', { className: `cards-field${wide ? ' cards-field-wide' : ''}` }, e('span', null, label), control)
}
