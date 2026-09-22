import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  defaultSettings,
  type RecapCard,
  type RecapPersistedState,
  type RecapSettings,
  type RecapStore,
} from './contracts.ts'
import { storedSettings } from './schema.ts'
import type { TaskCheckpoint } from '@klarkxy/dsh-ai-services/contracts'

const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  cardsEnabled: z.boolean(),
  checkpointsEnabled: z.boolean(),
  semanticCheckpointsEnabled: z.boolean(),
  idleReturnMs: z.number().int().min(60_000).max(180 * 60_000),
}).strict()

const evidenceSchema = z.object({
  sessionId: z.string().min(1).max(200),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['user', 'tool', 'turn', 'manual']),
  excerpt: z.string().max(200).optional(),
}).strict()

const cardSchema = z.object({
  id: z.string().min(1).max(80),
  sessionId: z.string().min(1).max(200),
  sourceVersion: z.string().min(1).max(280),
  fromSeq: z.number().int().nonnegative(),
  toSeq: z.number().int().nonnegative(),
  trigger: z.enum(['turn-end', 'idle-return', 'retry', 'manual']),
  sourceStatus: z.enum(['completed', 'failed', 'cancelled']),
  title: z.string().max(80),
  body: z.string().max(4000),
  kind: z.enum(['deterministic', 'generated', 'cached']),
  generation: z.enum(['idle', 'running', 'failed', 'cancelled', 'superseded']),
  receiptId: z.string().max(120).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

const checkpointSchema = z.object({
  id: z.string().min(1).max(80),
  sessionId: z.string().min(1).max(200),
  sourceVersion: z.string().min(1).max(280),
  contractVersion: z.number().int().nonnegative().optional(),
  fromSeq: z.number().int().nonnegative(),
  toSeq: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  items: z.array(z.object({
    label: z.string().max(200),
    state: z.enum(['pending', 'verified', 'failed']),
    evidence: z.array(evidenceSchema).max(16),
  }).strict()).max(32),
  constraints: z.array(z.string().max(200)).max(32),
  nextAction: z.string().max(400),
  createdAt: z.number().int().nonnegative(),
}).strict()

export const recapStateSchema = z.object({
  settings: settingsSchema,
  cards: z.array(cardSchema).max(1024),
  checkpoints: z.array(checkpointSchema).max(1024),
}).strict()

export const recapDomain = defineDomain({
  name: 'dsh_editor_recap',
  version: 2,
  tables: {
    state: domainTable<string, RecapPersistedState>(recapStateSchema),
  },
})

export type RecapDomainHandle = {
  table(name: 'state'): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    entries(): IterableIterator<[string, unknown]>
  }
  close(): Promise<void>
}

export function emptyRecapState(): RecapPersistedState {
  return { settings: defaultSettings(), cards: [], checkpoints: [] }
}

export function domainStore(domain: RecapDomainHandle): RecapStore {
  const table = domain.table('state')
  return {
    load(): RecapPersistedState {
      const row = table.get('global') as RecapPersistedState | undefined
      if (!row) return emptyRecapState()
      return {
        settings: storedSettings(row.settings as RecapSettings | undefined),
        cards: Array.isArray(row.cards) ? row.cards.map(card => ({ ...card })) as RecapCard[] : [],
        checkpoints: Array.isArray(row.checkpoints) ? row.checkpoints.map(checkpoint => ({
          ...checkpoint,
          items: checkpoint.items.map(item => ({ ...item, evidence: [...item.evidence] })),
          constraints: [...checkpoint.constraints],
        })) as RecapPersistedState['checkpoints'] : [],
      }
    },
    async save(state) {
      await table.put('global', {
        settings: { ...state.settings },
        cards: state.cards.map(card => ({ ...card })),
        checkpoints: state.checkpoints.map(row => ({
          ...row,
          items: row.items.map(item => ({ ...item, evidence: [...item.evidence] })),
          constraints: [...row.constraints],
        })),
      } satisfies RecapPersistedState)
    },
  }
}

export type { RecapCard, RecapPersistedState, RecapSettings, RecapStore, TaskCheckpoint }
