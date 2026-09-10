export type ArchiveResponse = {
  archiveId: string
  path: string
  createdAt: string
  bytes: number
  state: 'archived' | 'pending-archive' | 'pending-restore' | 'restored' | 'blocked'
  version?: string
  message?: string
  metadataWarning?: string
}
export type ArchiveListResponse = { items: ArchiveResponse[]; invalid: number }
