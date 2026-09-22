import { PROVIDER_ID } from './contracts.ts'
import { occupiedProviderId, type TitleSlot } from './ownership.ts'

export interface SessionTitleProvider {
  readonly id: string
  readonly automatic: 'first-prompt' | 'all-prompts'
  generate(request: {
    session: { id: string; snapshotEvents(): readonly unknown[] }
    messages: ReadonlyArray<{ seq: number; text: string }>
    route?: { provider: string; model: string }
    signal: AbortSignal
  }): Promise<{ title: string; messageSeqs: readonly number[]; model?: { provider: string; model: string } }>
}

export interface SessionTitleServiceLike {
  register(provider: SessionTitleProvider): () => void | Promise<void>
  get(session: unknown): { title: string; source?: { kind?: string; provider?: string }; eventSeq?: number; updatedAt?: number; messageSeqs?: readonly number[] } | undefined
  refresh(session: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface LoaderEntryOptions {
  id?: string
  name?: string
  disabled?: boolean | null
  config?: unknown
  inject?: unknown
  group?: boolean | null
}

export interface LoaderEntry {
  id: string
  options?: LoaderEntryOptions
}

export interface LoaderFace {
  entries(): Iterable<LoaderEntry>
  update(id: string, options: { disabled?: boolean | null }): Promise<unknown> | unknown
}

export interface Displacement {
  readonly id: string
  readonly name: string
  readonly identity: string
}

function catalogLookupId(entryId: string): string {
  const colon = entryId.indexOf(':')
  return colon === -1 ? entryId : entryId.slice(colon + 1)
}

function entryName(entry: LoaderEntry): string {
  return String(entry.options?.name ?? '')
}

export function entryDisabled(entry: LoaderEntry): boolean {
  return entry.options?.disabled === true
}

export function displacementIdentity(entry: LoaderEntry): string {
  const options = entry.options ?? {}
  const { disabled: _disabled, ...rest } = options
  return JSON.stringify({ id: entry.id, name: entryName(entry), rest })
}

export function captureDisplacement(entry: LoaderEntry): Displacement {
  return { id: entry.id, name: entryName(entry), identity: displacementIdentity(entry) }
}

export function displacementUnchanged(snapshot: Displacement, entry: LoaderEntry): boolean {
  return entry.id === snapshot.id
    && entryName(entry) === snapshot.name
    && displacementIdentity(entry) === snapshot.identity
}

export function findEntryById(loader: LoaderFace, id: string): LoaderEntry | undefined {
  for (const entry of loader.entries()) {
    if (entry.id === id) return entry
  }
  return undefined
}

export function findLoaderEntry(loader: LoaderFace, providerId: string): LoaderEntry | undefined {
  for (const entry of loader.entries()) {
    const name = entryName(entry)
    const ids = [entry.id, entry.options?.id, name, catalogLookupId(entry.id)]
    if (ids.some(value => value === providerId)) return entry
    if (name.endsWith(`/${providerId}`) || name.endsWith(providerId)) return entry
    if (providerId === 'session-title-first-prompt-llm' && catalogLookupId(entry.id) === 'session-title-llm') return entry
  }
  return undefined
}

export async function restoreOwnDisplacement(loader: LoaderFace | undefined, snapshot: Displacement | undefined): Promise<'restored' | 'skipped'> {
  if (!loader || !snapshot) return 'skipped'
  const current = findEntryById(loader, snapshot.id)
  if (!current || !entryDisabled(current) || !displacementUnchanged(snapshot, current)) return 'skipped'
  await loader.update(snapshot.id, { disabled: false })
  return 'restored'
}

export function createNativeTitleSlot(options: {
  sessionTitle: SessionTitleServiceLike
  loader: LoaderFace
  generate: SessionTitleProvider['generate']
}): TitleSlot & { displacement?: Displacement } {
  let owner: string | undefined
  const slot: TitleSlot & { displacement?: Displacement } = {
    owner: () => owner,
    async occupy(id: string) {
      const provider: SessionTitleProvider = {
        id: PROVIDER_ID,
        automatic: 'all-prompts',
        generate: options.generate,
      }
      try {
        const dispose = options.sessionTitle.register(provider)
        owner = id
        return async () => {
          await dispose()
          if (owner === id) owner = undefined
        }
      } catch (error) {
        const occupied = occupiedProviderId(error)
        if (!occupied) throw error
        const entry = findLoaderEntry(options.loader, occupied)
        if (!entry || entryDisabled(entry)) throw error
        const snapshot = captureDisplacement(entry)
        await options.loader.update(entry.id, { disabled: true })
        const afterDisable = findEntryById(options.loader, entry.id)
        if (!afterDisable || !displacementUnchanged(snapshot, afterDisable)) throw error
        try {
          const dispose = options.sessionTitle.register(provider)
          slot.displacement = snapshot
          owner = id
          return async () => {
            await dispose()
            if (owner === id) owner = undefined
          }
        } catch (second) {
          if (findEntryById(options.loader, snapshot.id) && displacementUnchanged(snapshot, findEntryById(options.loader, snapshot.id)!)) {
            await options.loader.update(snapshot.id, { disabled: false })
          }
          throw second
        }
      }
    },
  }
  return slot
}
