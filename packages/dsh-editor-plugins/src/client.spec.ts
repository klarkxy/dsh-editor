import { describe, expect, it } from 'vitest'
import type { PluginInspectReport } from './contracts.ts'
import {
  canConfirmPluginInstall,
  handleMarketplaceGithubClick,
  isCurrentInstallAttempt,
  pluginInstallNotice,
} from './client.tsx'

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

})
