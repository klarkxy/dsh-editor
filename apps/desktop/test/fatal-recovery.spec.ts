import { describe, expect, it, vi } from 'vitest'
import { DesktopFatalRecovery, type FatalRecoveryOperations } from '../src/fatal-recovery.js'

function harness(overrides: Partial<FatalRecoveryOperations> = {}) {
  const calls = {
    showDialog: [] as Array<{ message: string; buttons: string[] }>,
    reports: [] as Array<{ error: unknown; source: string }>,
    stops: 0,
    disables: 0,
    relaunches: 0,
    exits: 0,
  }
  const responses: number[] = []
  const operations: FatalRecoveryOperations = {
    showDialog: vi.fn(async (options) => {
      calls.showDialog.push({ message: options.message, buttons: options.buttons })
      return responses.length ? responses.shift()! : 0
    }),
    writeReport: vi.fn(async (error, source) => {
      calls.reports.push({ error, source })
      return 'D:/logs/crash-x.log'
    }),
    stopBackend: vi.fn(async () => { calls.stops += 1 }),
    disablePlugins: vi.fn(async () => { calls.disables += 1 }),
    relaunch: vi.fn(() => { calls.relaunches += 1 }),
    exit: vi.fn(() => { calls.exits += 1 }),
    isShuttingDown: () => false,
    ...overrides,
  }
  return {
    calls,
    operations,
    respond(...values: number[]) { responses.push(...values) },
    recovery: new DesktopFatalRecovery(operations),
  }
}

describe('desktop fatal recovery', () => {
  it('routes 退出 to stop + exit without relaunching', async () => {
    const h = harness()
    h.respond(0)
    await h.recovery.report(new Error('boom'), 'supervisor')
    expect(h.calls.stops).toBe(1)
    expect(h.calls.exits).toBe(1)
    expect(h.calls.relaunches).toBe(0)
    expect(h.calls.disables).toBe(0)
    expect(h.calls.reports).toHaveLength(1)
    expect(h.calls.showDialog[0]?.buttons).toEqual(['退出', '重启', '禁用第三方插件并重启'])
  })
  it('routes 重启 to stop + relaunch', async () => {
    const h = harness()
    h.respond(1)
    await h.recovery.report(new Error('boom'), 'renderer')
    expect(h.calls.stops).toBe(1)
    expect(h.calls.relaunches).toBe(1)
    expect(h.calls.disables).toBe(0)
    expect(h.calls.exits).toBe(0)
  })
  it('routes 禁用第三方插件并重启 to stop + disable + relaunch', async () => {
    const h = harness()
    h.respond(2)
    await h.recovery.report(new Error('boom'), 'main')
    expect(h.calls.stops).toBe(1)
    expect(h.calls.disables).toBe(1)
    expect(h.calls.relaunches).toBe(1)
  })
  it('lets only the first fatal error open the dialog', async () => {
    const h = harness()
    h.respond(1)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await Promise.all([
      h.recovery.report(new Error('first'), 'supervisor'),
      h.recovery.report(new Error('second'), 'renderer'),
    ])
    expect(h.calls.showDialog).toHaveLength(1)
    expect(h.calls.reports).toHaveLength(1)
    expect(h.calls.relaunches).toBe(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
  it('re-prompts with the failure when a recovery operation fails', async () => {
    const h = harness({
      disablePlugins: vi.fn(async () => { throw new Error('state file locked') }),
    })
    h.respond(2, 1)
    await h.recovery.report(new Error('boom'), 'supervisor')
    expect(h.calls.showDialog).toHaveLength(2)
    expect(h.calls.showDialog[1]?.message).toBe('恢复操作未能完成')
    expect(h.calls.relaunches).toBe(1)
  })
  it('exits when the dialog itself is unavailable', async () => {
    const h = harness({
      showDialog: vi.fn(async () => { throw new Error('app not ready') }),
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await h.recovery.report(new Error('boom'), 'main')
    expect(h.calls.exits).toBe(1)
    expect(h.calls.relaunches).toBe(0)
    consoleError.mockRestore()
  })
  it('opens the dialog without a path when report writing hangs past the bound', async () => {
    const h = harness({ writeReport: vi.fn(() => new Promise<string | undefined>(() => undefined)) })
    h.respond(0)
    await h.recovery.report(new Error('boom'), 'renderer')
    expect(h.calls.showDialog).toHaveLength(1)
    expect(h.calls.exits).toBe(1)
  }, 10_000)
  it('reportFatal only writes the report while shutting down', async () => {
    const h = harness({ isShuttingDown: () => true })
    await h.recovery.reportFatal(new Error('boom'), 'renderer')
    expect(h.calls.reports).toHaveLength(1)
    expect(h.calls.showDialog).toHaveLength(0)
    expect(h.calls.exits).toBe(0)
  })
  it('reportFatal delegates to the dialog flow when not shutting down', async () => {
    const h = harness()
    h.respond(0)
    await h.recovery.reportFatal(new Error('boom'), 'renderer')
    expect(h.calls.showDialog).toHaveLength(1)
    expect(h.calls.exits).toBe(1)
  })
})
