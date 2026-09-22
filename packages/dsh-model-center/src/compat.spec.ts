import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as shared from '@klarkxy/dsh-ai-services/contracts'
import {
  AI_RPC_CHANNEL, MODEL_SETTINGS_SLOT, type AiPolicy, type ModelTarget, type ResolvedRoute,
} from './contracts.ts'

describe('frozen shared contracts', () => {
  it('reexports channel and models seat from @klarkxy/dsh-ai-services/contracts', () => {
    expect(AI_RPC_CHANNEL).toBe(shared.AI_RPC_CHANNEL)
    expect(MODEL_SETTINGS_SLOT).toBe(shared.MODEL_SETTINGS_SLOT)
    expect(AI_RPC_CHANNEL).toBe('/dsh-ai-services')
    expect(MODEL_SETTINGS_SLOT).toBe('dsh-editor.settings.models')
  })

  it('accepts an AiPolicy value that satisfies the frozen shape', () => {
    const policy: AiPolicy = {
      revision: 1,
      roles: { normal: { provider: 'deepseek', model: 'deepseek-chat' } },
      purposes: { compaction: { kind: 'role', role: 'weak' } },
      limits: { concurrency: 1, timeoutMs: 30_000, maxInputChars: 8000, maxOutputTokens: 1024, maxAttempts: 2 },
    }
    const target: ModelTarget = { kind: 'session' }
    const resolved: ResolvedRoute = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      source: 'purpose',
      target,
      policyRevision: 1,
      inheritedRole: 'normal',
    }
    const sharedPolicy: shared.AiPolicy = policy
    const sharedResolved: shared.ResolvedRoute = resolved
    expect(sharedPolicy.roles.normal?.provider).toBe('deepseek')
    expect(sharedResolved.inheritedRole).toBe('normal')
  })

  it('ships enabled without starting inference', () => {
    const patch = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/id: model-center/)
    expect(patch).toMatch(/disabled:\s*false/)
    expect(patch).not.toMatch(/disabled:\s*true/)
  })
})
