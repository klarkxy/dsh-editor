import { describe, expect, it, vi } from 'vitest'
import type { AiFeatureScope } from '@klarkxy/dsh-ai-services/contracts'
import { PURPOSE_ID, defaultGenerateConfig } from './contracts.ts'
import { generateCurrentTitle } from './generate.ts'

function receipt(status: 'success' | 'cancelled' | 'superseded', route?: { provider: string; model: string }) {
  return {
    id: 'r1',
    plugin: '@klarkxy/dsh-current-title',
    purpose: PURPOSE_ID,
    sourceVersion: 's1:2:2',
    status,
    attempts: 1,
    cost: null,
    startedAt: 0,
    finishedAt: 1,
    ...(route ? {
      route: {
        ...route,
        source: 'default' as const,
        target: { kind: 'role' as const, role: 'weak' as const },
        policyRevision: 0,
      },
    } : {}),
  }
}

function scope(run: AiFeatureScope['run'], active = true): AiFeatureScope {
  return {
    plugin: '@klarkxy/dsh-current-title',
    signal: new AbortController().signal,
    active,
    registerPurpose: () => () => {},
    run,
    dispose() {},
  }
}

describe('generateCurrentTitle', () => {
  it('calls aiServices on the weak current-title.generate purpose and formats a zh type prefix', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    const run = vi.fn(async (request: Parameters<AiFeatureScope['run']>[0]) => {
      expect(request.purpose).toBe(PURPOSE_ID)
      expect(request.priority).toBe('background')
      expect(request.input).toContain('现在修复登录回调失败')
      return { text: '{"type":"fix","summary":"登录回调失败"}', receipt: receipt('success', { provider: 'weak', model: 'flash' }) }
    })
    const result = await generateCurrentTitle({
      scope: scope(run),
      config: defaultGenerateConfig('auto'),
      sessionId: 's1',
      messages: [
        { seq: 1, text: '旧任务已经完成' },
        { seq: 2, text: '现在修复登录回调失败' },
      ],
      signal: new AbortController().signal,
      isCurrent: () => true,
    })
    expect(result.title).toBe('0903 | 修复 | 登录回调失败')
    expect(result.messageSeqs).toEqual([1, 2])
    expect(result.model).toEqual({ provider: 'weak', model: 'flash' })
    vi.useRealTimers()
  })

  it('uses the DSH locale preference for the type label', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    const result = await generateCurrentTitle({
      scope: scope(async () => ({ text: '{"type":"fix","summary":"login callback"}', receipt: receipt('success') })),
      config: defaultGenerateConfig('auto'),
      sessionId: 's1',
      messages: [{ seq: 1, text: '现在修复登录回调失败' }],
      localePreference: 'en-US',
      signal: new AbortController().signal,
      isCurrent: () => true,
    })
    expect(result.title).toBe('0903 | Fix | login callback')
    vi.useRealTimers()
  })

  it('rejects stale results after disable or superseded checks', async () => {
    await expect(generateCurrentTitle({
      scope: scope(async () => ({ text: '{"type":"fix","summary":"x"}', receipt: receipt('success') }), false),
      config: defaultGenerateConfig(),
      sessionId: 's1',
      messages: [{ seq: 1, text: '修复登录' }],
      signal: new AbortController().signal,
      isCurrent: () => true,
    })).rejects.toThrow(/no longer current/)
  })

  it('cancels when the signal aborts during generation', async () => {
    const controller = new AbortController()
    let release!: (value: { text: string; receipt: ReturnType<typeof receipt> }) => void
    const pending = generateCurrentTitle({
      scope: scope(() => new Promise(resolve => { release = resolve })),
      config: defaultGenerateConfig(),
      sessionId: 's1',
      messages: [{ seq: 1, text: '修复登录' }],
      signal: controller.signal,
      isCurrent: () => true,
    })
    controller.abort(new Error('current-title cancelled'))
    await expect(pending).rejects.toThrow(/cancel/)
    release({ text: '{"type":"fix","summary":"登录"}', receipt: receipt('success') })
  })
})
