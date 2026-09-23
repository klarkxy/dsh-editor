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
  if (path === state.selectedPath) return
  leaveDetail(() => setState({ ...state, selectedPath: path }))
}

export function setCardsCatalog(catalog: CardsCatalog): void {
  setState({ ...state, catalog })
}

/* 详情表单有未保存修改时由 detail.tsx 注册守卫;返回 false 表示已拦截,
   守卫负责弹确认并在用户放弃后调用 proceed。 */
type DetailLeaveGuard = (proceed: () => void) => boolean

let detailLeaveGuard: DetailLeaveGuard | null = null

export function setCardsDetailLeaveGuard(guard: DetailLeaveGuard | null): void {
  detailLeaveGuard = guard
}

function leaveDetail(action: () => void): boolean {
  if (detailLeaveGuard && !detailLeaveGuard(action)) return false
  action()
  return true
}

export function closeCardsDetail(): boolean {
  return leaveDetail(() => setState({ ...state, selectedPath: null }))
}

export function closeCardsPanel(): void {
  setState({ ...state, open: false, selectedPath: null })
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
