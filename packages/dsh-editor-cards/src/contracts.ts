import type { CharacterCardFields, WorldbookCardFields } from 'dsh-editor-workspace-kit/frontmatter'

export type {
  CardMetaFields,
  CardRelation,
  CharacterCardFields,
  WorldbookCardFields,
} from 'dsh-editor-workspace-kit/frontmatter'

/** Loopback-only Host RPC channel for character and worldbook cards. */
export const CARDS_RPC_CHANNEL = '/dsh-editor-cards'

export type CardKind = 'character' | 'worldbook'
export type CardsListKind = CardKind | 'all'
export type CharacterCard = {
  path: string
  title: string
  frontmatter: CharacterCardFields
  summary: string
  version: string
  modifiedAt: string | null
}
export type WorldbookCard = {
  path: string
  title: string
  frontmatter: WorldbookCardFields
  summary: string
  version: string
  modifiedAt: string | null
}
export type CardsListRequest = { sessionId: string; kind: CardsListKind }
export type CardsListResponse = {
  characters: CharacterCard[]
  worldbook: WorldbookCard[]
  scannedFiles: number
  skipped: number
  truncated: boolean
}
export type CardsMetaSetRequest = { sessionId: string; path: string; version: string; fields: Partial<CharacterCardFields & WorldbookCardFields> }
export type CardsMetaSetResponse = { path: string; version: string }
export type CardReferenceHit = { path: string; line: number; column: number; start: number; end: number; excerpt: string }
export type CardsReferencesRequest = { sessionId: string; path: string }
export type CardsReferencesResponse = { terms: string[]; hits: CardReferenceHit[]; scannedFiles: number; truncated: boolean }
export type CardsCreateRequest = { sessionId: string; kind: CardKind; title: string; fields?: Partial<CharacterCardFields & WorldbookCardFields> }
export type CardsCreateResponse = { path: string; version: string }

export type CardsEndpoint = 'cards.list' | 'cards.references' | 'cards.metaSet' | 'cards.create'
export type CardsRequestMap = {
  'cards.list': CardsListRequest
  'cards.references': CardsReferencesRequest
  'cards.metaSet': CardsMetaSetRequest
  'cards.create': CardsCreateRequest
}
export type CardsResponseMap = {
  'cards.list': CardsListResponse
  'cards.references': CardsReferencesResponse
  'cards.metaSet': CardsMetaSetResponse
  'cards.create': CardsCreateResponse
}

export type CardsRpcIssue = { code: 'custom'; path: string[]; message: string }
export type CardsRpcError =
  | { code: 'bad-request'; message: string; details: { issues: CardsRpcIssue[] } }
  | { code: 'cancelled'; message: string; details: Record<string, never> }
  | { code: 'session-not-found'; message: string; details: { sessionId: string } }
  | { code: 'workspace-attach-failed'; message: string; details: { sessionId: string; workspaceId: string } }
  | { code: 'workspace-not-found'; message: string; details: { workspaceId: string } }
  | { code: 'workspace-invalid-path'; message: string; details: { path: string } }
  | { code: 'directory-unreadable'; message: string; details: { path: string } }
  | { code: 'directory-exists'; message: string; details: { path: string } }
  | { code: 'internal'; message: string; details: Record<string, unknown> }
export type CardsRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: CardsRpcError }
