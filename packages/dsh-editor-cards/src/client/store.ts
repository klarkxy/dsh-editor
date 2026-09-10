import type { CardKind, CharacterCard, WorldbookCard } from '../contracts.ts'
import { isCharacterCardPath, isWorldbookCardPath } from '../cards-view.ts'

export type CardsCatalog = { characters: CharacterCard[]; worldbook: WorldbookCard[] }

export type CardsStoreState = {
  open: boolean
  kind: CardKind
  selectedPath: string | null
  catalog: CardsCatalog
}

const EMPTY_CATALOG: CardsCatalog = { characters: [], worldbook: [] }

const listeners = new Set<() => void>()
let state: CardsStoreState = {
  open: false,
  kind: 'character',
  selectedPath: null,
  catalog: EMPTY_CATALOG,
}

function emit(): void {
  for (const listener of listeners) listener()
}

function setState(next: CardsStoreState): void {
  state = next
  emit()
}

export function getCardsState(): CardsStoreState {
  return state
}

export function subscribeCardsStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function pathMatchesKind(path: string | null, kind: CardKind): boolean {
  if (!path) return false
  return kind === 'character' ? isCharacterCardPath(path) : isWorldbookCardPath(path)
}

export function openCardsPanel(kind: CardKind): void {
  setState({
    ...state,
    open: true,
    kind,
    selectedPath: pathMatchesKind(state.selectedPath, kind) ? state.selectedPath : null,
  })
}

export function selectCard(path: string | null): void {
  setState({ ...state, selectedPath: path })
}

export function setCardsCatalog(catalog: CardsCatalog): void {
  setState({ ...state, catalog })
}

export function closeCardsDetail(): void {
  setState({ ...state, selectedPath: null })
}

export function resetCardsStore(): void {
  setState({
    open: false,
    kind: 'character',
    selectedPath: null,
    catalog: EMPTY_CATALOG,
  })
}

let boundSessionId: string | null = null

/** Reset plugin-local cards state when the Shell session changes. */
export function bindCardsSession(sessionId: string): void {
  if (boundSessionId === sessionId) return
  boundSessionId = sessionId
  resetCardsStore()
}
