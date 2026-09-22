import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { MAX_PROJECT_ID_CHARS, defaultSettings, type MoodSettings } from './contracts.ts'
import type { MoodPersistedState, MoodStoredSession, MoodStore } from './service.ts'

const evidenceSchema = z.object({
  sessionId: z.string().min(1).max(200),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['user', 'tool', 'turn', 'manual']),
  excerpt: z.string().max(200).optional(),
}).strict()

const contractSchema = z.object({
  id: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(200),
  sourceVersion: z.string().min(1).max(400),
  revision: z.number().int().nonnegative(),
  goal: z.string().max(2000),
  deliverables: z.array(z.string().max(400)).max(16),
  inScope: z.array(z.string().max(400)).max(16),
  outOfScope: z.array(z.string().max(400)).max(16),
  constraints: z.array(z.string().max(400)).max(16),
  acceptance: z.array(z.string().max(400)).max(16),
  assumptions: z.array(z.string().max(400)).max(16),
  questions: z.array(z.string().max(400)).max(8),
  evidence: z.array(evidenceSchema).max(32),
  readiness: z.enum(['pending', 'clear-request', 'user-confirmed', 'disclosed-assumptions', 'cancelled', 'stale']),
  updatedAt: z.number().int().nonnegative(),
}).strict()

const clarificationSchema = z.object({
  id: z.string().min(1).max(80),
  question: z.string().max(400),
  status: z.enum(['pending', 'answered', 'skipped', 'cancelled', 'stale']),
  answer: z.string().max(400).optional(),
}).strict()

const heldRequestSchema = z.object({
  sourceVersion: z.string().min(1).max(400),
  trigger: z.enum(['material', 'risk', 'mild', 'clear']),
  messages: z.array(z.unknown()).max(32),
}).strict()

const sessionSchema = z.object({
  contract: contractSchema.optional(),
  clarification: z.array(clarificationSchema).max(8),
  lastHandledVersion: z.string().max(400).optional(),
  pendingManual: z.boolean(),
  projectId: z.string().max(MAX_PROJECT_ID_CHARS).optional(),
  heldRequest: heldRequestSchema.optional(),
}).strict()

const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  mode: z.enum(['auto', 'manual', 'strict']),
}).strict()

export const moodStateSchema = z.object({
  settings: settingsSchema,
  sessions: z.record(z.string().min(1).max(200), sessionSchema),
}).strict()

export const moodDomain = defineDomain({
  name: 'dsh_editor_mood',
  version: 1,
  tables: {
    state: domainTable<string, MoodPersistedState>(moodStateSchema),
  },
})

export type MoodDomainHandle = {
  table(name: 'state'): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    entries(): IterableIterator<[string, unknown]>
  }
  close(): Promise<void>
}

export function emptyMoodState(): MoodPersistedState {
  return { settings: defaultSettings(), sessions: {} }
}

export function domainStore(domain: MoodDomainHandle): MoodStore {
  const table = domain.table('state')
  return {
    load(): MoodPersistedState {
      const row = table.get('global') as MoodPersistedState | undefined
      if (!row) return emptyMoodState()
      return {
        settings: { ...defaultSettings(), ...row.settings } as MoodSettings,
        sessions: { ...(row.sessions ?? {}) } as Record<string, MoodStoredSession>,
      }
    },
    async save(state) {
      await table.put('global', {
        settings: { ...state.settings },
        sessions: { ...state.sessions },
      } satisfies MoodPersistedState)
    },
  }
}
