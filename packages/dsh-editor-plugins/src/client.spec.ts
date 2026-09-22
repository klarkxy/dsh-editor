import { describe, expect, it } from 'vitest'
import type { PluginInspectReport } from './contracts.ts'
import {
  apply,
  bootClientEntryIds,
  canConfirmPluginInstall,
  CLIENT_GRAPH_RELOAD_NOTICE,
  clientGraphNeedsReload,
  handleMarketplaceGithubClick,
  isCurrentInstallAttempt,
  pluginInstallNotice,
  pluginToggleFollowUp,
} from './client.tsx'
import { pluginsClientStyles } from './client-styles.ts'

const ready: PluginInspectReport = { verdict: 'ready', entries: [], hasClient: false, findings: [] }
const warn: PluginInspectReport = {
  verdict: 'warn',
  entries: [],
  hasClient: true,
  findings: [{ code: 'client-slot', severity: 'warning', message: '工作台里可能看不到界面' }],
}
const blocked: PluginInspectReport = {
  verdict: 'blocked',
  entries: [],
  hasClient: false,
  findings: [{ code: 'bundle-patch', severity: 'error', message: '不是可安装的 DSH 插件' }],
}

describe('plugin market install confirmation', () => {
  it('enables confirm only for ready/warn after inspect, not while checking or installing', () => {
    expect(canConfirmPluginInstall(ready)).toBe(true)
    expect(canConfirmPluginInstall(warn)).toBe(true)
    expect(canConfirmPluginInstall(blocked)).toBe(false)
    expect(canConfirmPluginInstall(null)).toBe(false)
    expect(canConfirmPluginInstall(ready, { inspecting: true })).toBe(false)
    expect(canConfirmPluginInstall(warn, { installing: true })).toBe(false)
  })

  it('keeps warn findings in the success notice and does not point at a hidden report', () => {
    expect(pluginInstallNotice('acme-plug', ready)).toBe('已安装 acme-plug。请重启应用后使用。')
    expect(pluginInstallNotice('acme-plug', warn)).toBe('已安装 acme-plug。请重启应用后使用。注意事项：工作台里可能看不到界面')
    expect(pluginInstallNotice('acme-plug', warn)).not.toContain('见下方')
  })

  it('drops delayed inspect results after cancel, unmount, or a later spec', () => {
    expect(isCurrentInstallAttempt({
      mounted: true, token: 1, currentToken: 1, openSpec: 'github:acme/a', resultSpec: 'github:acme/a',
    })).toBe(true)
    expect(isCurrentInstallAttempt({
      mounted: true, token: 1, currentToken: 2, openSpec: 'github:acme/a', resultSpec: 'github:acme/a',
    })).toBe(false)
    expect(isCurrentInstallAttempt({
      mounted: false, token: 2, currentToken: 2, openSpec: 'github:acme/a', resultSpec: 'github:acme/a',
    })).toBe(false)
    expect(isCurrentInstallAttempt({
      mounted: true, token: 2, currentToken: 2, openSpec: 'github:acme/b', resultSpec: 'github:acme/a',
    })).toBe(false)
    expect(isCurrentInstallAttempt({
      mounted: true, token: 2, currentToken: 2, openSpec: undefined, resultSpec: 'github:acme/a',
    })).toBe(false)
  })

  it('opens GitHub via window.dshWindow.openExternal when present, otherwise leaves the anchor', () => {
    const scope = globalThis as { window?: { dshWindow?: { openExternal(url: string): void } }; dshWindow?: unknown }
    const previousWindow = scope.window
    const previousBridge = scope.dshWindow
    const opened: string[] = []
    scope.window = { dshWindow: { openExternal(url) { opened.push(url) } } }
    delete scope.dshWindow
    try {
      let prevented = false
      handleMarketplaceGithubClick({ preventDefault() { prevented = true } }, 'https://github.com/acme/plug')
      expect(prevented).toBe(true)
      expect(opened).toEqual(['https://github.com/acme/plug'])
    } finally {
      if (previousWindow) scope.window = previousWindow
      else delete scope.window
      if (previousBridge !== undefined) scope.dshWindow = previousBridge
      else delete scope.dshWindow
    }

    delete scope.window
    delete scope.dshWindow
    try {
      let prevented = false
      handleMarketplaceGithubClick({ preventDefault() { prevented = true } }, 'https://github.com/acme/plug')
      expect(prevented).toBe(false)
    } finally {
      if (previousWindow) scope.window = previousWindow
      if (previousBridge !== undefined) scope.dshWindow = previousBridge
    }
  })

  it('forwards host Button and Input from settings slot props', () => {
    function MockButton() { return null }
    function MockInput() { return null }
    const renders: Array<(props: unknown) => { props: Record<string, unknown> }> = []
    apply({
      effect(fn: () => (() => void) | void) { fn() },
      slots: {
        inject(_key: string, callback: () => unknown) {
          callback()
          return () => {}
        },
        register(_spec: unknown, render: unknown) {
          renders.push(render as (typeof renders)[number])
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({}) } },
    } as never)
    expect(renders.length).toBe(1)
    const hosted = renders[0]!({ Button: MockButton, Input: MockInput })
    expect(hosted.props.Button).toBe(MockButton)
    expect(hosted.props.Input).toBe(MockInput)
  })

})

describe('plugin settings chrome', () => {
  it('separates plugin rows while keeping switch states visible', () => {
    expect(pluginsClientStyles).toContain('.dsh-plugins-card')
    expect(pluginsClientStyles).toContain('border-top: 1px solid var(--gray-a5)')
    expect(pluginsClientStyles).toContain('.dsh-plugins button.dsh-plugins-switch')
    expect(pluginsClientStyles).toContain('background: var(--gray-7)')
    expect(pluginsClientStyles).toContain('background: var(--accent-9)')
  })
})

describe('client graph reload notice', () => {
  const boot = ['dsh-editor-plugins', 'dsh-editor-shell']

  it('treats enable and disable graph changes as a real mismatch', () => {
    expect(clientGraphNeedsReload(
      ['dsh-editor-plugins', 'dsh-editor-shell', '@klarkxy/dsh-model-center'],
      boot,
    )).toBe(true)
    expect(clientGraphNeedsReload(
      ['dsh-editor-plugins'],
      boot,
    )).toBe(true)
    expect(pluginToggleFollowUp({
      restartRequired: false,
      enabledMatches: true,
      enabled: true,
      title: '模型中心',
      clientGraphChanged: true,
    })).toEqual({ persist: true, error: false, message: CLIENT_GRAPH_RELOAD_NOTICE })
    expect(pluginToggleFollowUp({
      restartRequired: false,
      enabledMatches: true,
      enabled: false,
      title: '模型中心',
      clientGraphChanged: true,
    })).toEqual({ persist: true, error: false, message: CLIENT_GRAPH_RELOAD_NOTICE })
  })

  it('does not warn for a clientless host or missing boot graph', () => {
    expect(clientGraphNeedsReload(undefined, boot)).toBe(false)
    expect(clientGraphNeedsReload(boot, undefined)).toBe(false)
    expect(bootClientEntryIds(null)).toBeUndefined()
    expect(bootClientEntryIds({ rev: '1' })).toBeUndefined()
    expect(pluginToggleFollowUp({
      restartRequired: false,
      enabledMatches: true,
      enabled: true,
      title: '知乎资料',
      clientGraphChanged: false,
    })).toEqual({ persist: false, error: false, message: '已启用 知乎资料。' })
  })

  it('clears the notice when refreshed boot ids equal the native graph', () => {
    const native = ['dsh-editor-shell', '@klarkxy/dsh-model-center', 'dsh-editor-plugins']
    expect(clientGraphNeedsReload(native, ['dsh-editor-plugins', 'dsh-editor-shell'])).toBe(true)
    expect(clientGraphNeedsReload(native, ['@klarkxy/dsh-model-center', 'dsh-editor-plugins', 'dsh-editor-shell'])).toBe(false)
    const scope = globalThis as { __DSH_BOOT__?: unknown }
    const previous = scope.__DSH_BOOT__
    scope.__DSH_BOOT__ = {
      entries: native.map((id) => ({ id })),
    }
    try {
      expect(bootClientEntryIds()).toEqual(native)
      expect(clientGraphNeedsReload(native, bootClientEntryIds())).toBe(false)
    } finally {
      if (previous === undefined) delete scope.__DSH_BOOT__
      else scope.__DSH_BOOT__ = previous
    }
  })

  it('does not ignore restartRequired just because the loader enabled boolean matches', () => {
    expect(pluginToggleFollowUp({
      restartRequired: true,
      enabledMatches: true,
      enabled: true,
      title: '模型中心',
      clientGraphChanged: false,
    })).toEqual({ persist: false, error: false, message: '已保存，重启应用后完全生效。' })
  })
})
