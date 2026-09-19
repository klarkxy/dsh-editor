import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { applyWebSearchTool, applyWebFetchTool } from '@deepseek-ai/dsh-tool-web'
import { apply } from './tools.ts'
import { defaultSettings } from './contracts.ts'
vi.mock('@deepseek-ai/dsh-tool-web', () => ({ applyWebSearchTool: vi.fn(), applyWebFetchTool: vi.fn() }))
it('does not expose tools before authorization and disposes the previous scope on change', async () => {
  vi.clearAllMocks()
  let listener = () => {}
  let teardown: () => Promise<void> = async () => {}
  const dispose = vi.fn(async () => {})
  let status = { settings: defaultSettings(), searchActive: false, fetchActive: false }
  const ctx = {
    webSearchManager: { status: () => status, subscribe: (callback: () => void) => { listener = callback; return () => { listener = () => {} } } },
    plugin: vi.fn((plugin: { apply(context: unknown): void }) => { plugin.apply(ctx); return { dispose } }),
    effect: (effect: () => () => Promise<void>) => { teardown = effect() },
  }
  apply(ctx as unknown as Context)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(ctx.plugin).not.toHaveBeenCalled()
  status = { ...status, searchActive: true }; listener()
  await vi.waitFor(() => expect(applyWebSearchTool).toHaveBeenCalledOnce())
  expect(applyWebFetchTool).not.toHaveBeenCalled()
  status = { ...status, searchActive: false }; listener()
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
  await teardown()
})
