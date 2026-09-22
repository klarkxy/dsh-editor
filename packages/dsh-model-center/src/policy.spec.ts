import { describe, expect, it } from 'vitest'
import type { AiPolicy } from './contracts.ts'
import { previewResolve, purposeRows, roleRoute } from './policy.ts'

const policy = (patch: Partial<AiPolicy> = {}): AiPolicy => ({
  revision: 2,
  roles: { normal: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' } },
  purposes: {},
  limits: { concurrency: 2, timeoutMs: 20_000, maxInputChars: 8000, maxOutputTokens: 1024, maxAttempts: 3 },
  ...patch,
})

describe('role and purpose resolution', () => {
  it('inherits unbound weak and strong from normal and records the source role', () => {
    const current = policy()
    expect(roleRoute(current, 'weak')).toEqual({
      route: current.roles.normal,
      inheritedRole: 'normal',
    })
    expect(roleRoute(current, 'strong')).toEqual({
      route: current.roles.normal,
      inheritedRole: 'normal',
    })
    const preview = previewResolve(current, 'compaction', {
      specs: [{ id: 'compaction', defaultTarget: { kind: 'role', role: 'weak' } }],
    })
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.route.source).toBe('default')
      expect(preview.route.inheritedRole).toBe('normal')
      expect(preview.route.provider).toBe('deepseek')
    }
  })

  it('does not treat follow-session as the normal binding', () => {
    const current = policy({ purposes: { title: { kind: 'session' } } })
    expect(roleRoute(current, 'normal')).toEqual({ route: current.roles.normal })
    const missing = previewResolve(current, 'title')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatch(/会话/)
    const withSession = previewResolve(current, 'title', { session: { provider: 'openai', model: 'gpt' } })
    expect(withSession.ok).toBe(true)
    if (withSession.ok) {
      expect(withSession.route.source).toBe('purpose')
      expect(withSession.route.provider).toBe('openai')
      expect(withSession.route.target).toEqual({ kind: 'session' })
    }
  })

  it('lets purpose override win over role defaults, then request override', () => {
    const current = policy({
      purposes: { compaction: { kind: 'role', role: 'strong' } },
      roles: {
        normal: { provider: 'deepseek', model: 'chat' },
        strong: { provider: 'openai', model: 'o1' },
      },
    })
    const purpose = previewResolve(current, 'compaction', {
      specs: [{ id: 'compaction', defaultTarget: { kind: 'role', role: 'weak' } }],
    })
    expect(purpose.ok).toBe(true)
    if (purpose.ok) {
      expect(purpose.route.source).toBe('purpose')
      expect(purpose.route.provider).toBe('openai')
    }
    const override = previewResolve(current, 'compaction', {
      override: { kind: 'model', provider: 'anthropic', model: 'sonnet' },
    })
    expect(override.ok).toBe(true)
    if (override.ok) {
      expect(override.route.source).toBe('override')
      expect(override.route.provider).toBe('anthropic')
    }
  })

  it('fails visibly on a broken explicit route instead of switching providers', () => {
    const current = policy({ purposes: { x: { kind: 'model', provider: 'gone', model: 'missing' } } })
    const preview = previewResolve(current, 'x', { knownProviders: new Set(['deepseek']) })
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.route.provider).toBe('gone')
      expect(preview.conflict).toMatch(/供应商/)
    }
  })

  it('only lists registered purposes, using catalogue defaults when unbound in policy', () => {
    const rows = purposeRows(policy(), [
      { id: 'compaction', label: '会话压缩', plugin: 'dsh', defaultTarget: { kind: 'role', role: 'weak' } },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('default')
    expect(purposeRows(policy(), [])).toEqual([])
  })
})
