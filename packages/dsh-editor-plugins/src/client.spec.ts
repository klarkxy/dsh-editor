import { createElement, Fragment, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { PluginCard, PluginInspectReport, PluginInventory, WritingPresetCard } from './contracts.ts'
import {
  apply,
  canConfirmPluginInstall,
  CLIENT_GRAPH_RELOAD_NOTICE,
  clientGraphNeedsReload,
  handleMarketplaceGithubClick,
  isCurrentInstallAttempt,
  PluginInstalledGroups,
  pluginInstallNotice,
  pluginToggleFollowUp,
  splitBundledCards,
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
      modules: { entries: { state: { getSnapshot: () => ({ syncing: false, failures: [] }), subscribe: () => () => {} } } },
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
    expect(pluginsClientStyles).toContain('border: 0.5px solid var(--s-line-strong)')
    expect(pluginsClientStyles).toContain('.dsh-plugins button.dsh-plugins-switch')
    expect(pluginsClientStyles).toContain('background: var(--s-track)')
    expect(pluginsClientStyles).toContain('background: var(--s-track-on)')
    expect(pluginsClientStyles).toContain('transform: translateX(16px)')
  })
})

describe('native client graph status', () => {
  it('only requests recovery after a settled failure and clears on retry or success', () => {
    const failures = [{ id: 'test-plugin', message: 'load failed' }]
    expect(clientGraphNeedsReload({ syncing: false, failures })).toBe(true)
    expect(clientGraphNeedsReload({ syncing: true, failures })).toBe(false)
    expect(clientGraphNeedsReload({ syncing: false, failures: [] })).toBe(false)
  })
  it('reports successful hot enablement without requiring a restart', () => {
    expect(pluginToggleFollowUp({ restartRequired: false, enabledMatches: true, enabled: true,
      title: '模型中心', clientGraphFailed: false })).toEqual({ persist: false, error: false, message: '已启用 模型中心。' })
  })
  it('preserves host restart requirements and client failure recovery', () => {
    expect(pluginToggleFollowUp({ restartRequired: true, enabledMatches: true, enabled: true,
      title: '模型中心', clientGraphFailed: false }).message).toContain('重启')
    expect(pluginToggleFollowUp({ restartRequired: false, enabledMatches: true, enabled: true,
      title: '模型中心', clientGraphFailed: true })).toEqual({ persist: true, error: false, message: CLIENT_GRAPH_RELOAD_NOTICE })
  })
})

function pluginCard(partial: Partial<PluginCard> & Pick<PluginCard, 'entryId' | 'packageName' | 'title'>): PluginCard {
  return {
    moduleName: partial.packageName,
    description: partial.description ?? partial.title,
    group: partial.group ?? 'optional',
    enabled: partial.enabled ?? true,
    locked: partial.locked ?? false,
    fiberPhase: partial.fiberPhase ?? 'active',
    origin: partial.origin ?? 'bundled',
    ...partial,
  }
}

const groupsInventory: PluginInventory = {
  core: [
    pluginCard({ entryId: 'include:editor-shell', packageName: 'dsh-editor-shell', title: '写作界面', group: 'core', locked: true, builtin: true }),
    pluginCard({ entryId: 'include:editor-novel-kernel', packageName: 'dsh-editor-novel-kernel', title: '小说工具', group: 'core', locked: true, builtin: true, managedBy: 'session' }),
    pluginCard({ entryId: 'proofread', packageName: 'dsh-proofread', title: '校对引擎', group: 'core', locked: true, builtin: false, managedBy: 'feature' }),
  ],
  optional: [
    pluginCard({ entryId: 'include:manuscript-assist', packageName: 'dsh-manuscript', title: '行内补全', builtin: true }),
    pluginCard({ entryId: 'include:zhihu', packageName: '@klarkxy/dsh-zhihu', title: '知乎资料', builtin: false }),
    pluginCard({ entryId: 'include:counterfeit', packageName: 'dsh-editor-counterfeit', title: '伪装内置包' }),
  ],
  community: [
    pluginCard({ entryId: 'include:theme', packageName: 'community-theme', title: '主题', group: 'community', origin: 'installed' }),
  ],
}

const groupsPresets: WritingPresetCard[] = [
  { id: 'dsh-editor-writing', title: '通用写作', description: '默认写作模式', enabled: true, locked: true },
  { id: 'novel-writing', title: '小说创作', description: '长篇小说', enabled: false, locked: false },
]

/* 本包不带 react-dom 依赖；设置页子树均为无 hook 纯组件（SeatButton 是无 hook 的
   forwardRef），用最小静态序列化做 SSR 断言，等价于 renderToStaticMarkup 的检查面。 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function staticMarkup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node))
  if (Array.isArray(node)) return node.map(staticMarkup).join('')
  const element = node as ReactElement<{ children?: ReactNode }>
  if (element.type === Fragment) return staticMarkup(element.props.children)
  if (typeof element.type === 'function') return staticMarkup((element.type as (props: unknown) => ReactNode)(element.props))
  const forwardRef = element.type as unknown as { render?: (props: unknown, ref: null) => ReactNode }
  if (typeof forwardRef === 'object' && typeof forwardRef.render === 'function') return staticMarkup(forwardRef.render(element.props, null))
  const tag = String(element.type)
  const attrs = Object.entries(element.props as Record<string, unknown>)
    .filter(([key]) => key !== 'children')
    .map(([key, value]) => {
      if (typeof value === 'boolean') return ` ${key}="${value}"`
      if (typeof value === 'string' || typeof value === 'number') return ` ${key}="${escapeHtml(String(value))}"`
      return ''
    })
    .join('')
  return `<${tag}${attrs}>${staticMarkup(element.props.children)}</${tag}>`
}

function renderInstalledGroups(overrides: { busyPackage?: string | null; inventory?: PluginInventory | null; presets?: WritingPresetCard[] | null } = {}): string {
  return staticMarkup(createElement(PluginInstalledGroups, {
    inventory: overrides.inventory === undefined ? groupsInventory : overrides.inventory,
    presets: overrides.presets === undefined ? groupsPresets : overrides.presets,
    busyPackage: overrides.busyPackage ?? null,
    busyPreset: null,
    onToggle: () => {},
    onTogglePreset: () => {},
    onUninstall: () => {},
  }))
}

describe('plugin installed grouping', () => {
  it('splits bundled cards by the trusted builtin flag, never by package prefix', () => {
    const { builtin, preinstalled } = splitBundledCards([...groupsInventory.core, ...groupsInventory.optional])
    expect(builtin.map((card) => card.packageName)).toEqual(['dsh-editor-shell', 'dsh-editor-novel-kernel', 'dsh-manuscript'])
    expect(preinstalled.map((card) => card.packageName)).toEqual(['dsh-proofread', '@klarkxy/dsh-zhihu', 'dsh-editor-counterfeit'])
  })

  it('renders one 内置插件 / 预装插件 / 已安装插件 section in order', () => {
    const html = renderInstalledGroups()
    const builtinAt = html.indexOf('plugins-section-builtin')
    const preinstalledAt = html.indexOf('plugins-section-preinstalled')
    const installedAt = html.indexOf('plugins-section-installed')
    expect(builtinAt).toBeGreaterThanOrEqual(0)
    expect(preinstalledAt).toBeGreaterThan(builtinAt)
    expect(installedAt).toBeGreaterThan(preinstalledAt)
    for (const heading of ['内置插件', '预装插件', '已安装插件']) {
      expect(html).toContain(`<h3>${heading}</h3>`)
    }
    expect(html.indexOf('写作辅助')).toBeGreaterThan(builtinAt)
    expect(html.indexOf('写作辅助')).toBeLessThan(preinstalledAt)
    expect(html.indexOf('小说工具')).toBeLessThan(preinstalledAt)
    for (const text of ['知乎资料', '伪装内置包', '由校对功能管理']) {
      expect(html.indexOf(text)).toBeGreaterThan(preinstalledAt)
      expect(html.indexOf(text)).toBeLessThan(installedAt)
    }
    expect(html.indexOf('主题（community-theme）')).toBeGreaterThan(installedAt)
  })

  it('keeps writing presets inside the builtin section on the same group', () => {
    const html = renderInstalledGroups()
    const builtinAt = html.indexOf('plugins-section-builtin')
    const preinstalledAt = html.indexOf('plugins-section-preinstalled')
    const presetsAt = html.indexOf('plugins-writing-presets')
    expect(presetsAt).toBeGreaterThan(builtinAt)
    expect(presetsAt).toBeLessThan(preinstalledAt)
    expect(html.indexOf('写作模式')).toBeGreaterThan(presetsAt)
    expect(html.indexOf('写作模式')).toBeLessThan(preinstalledAt)
    expect(html.indexOf('plugins-preset-toggle-novel-writing')).toBeGreaterThan(presetsAt)
    expect(html.indexOf('必需')).toBeGreaterThan(presetsAt)
    expect(html).not.toContain('plugins-preset-toggle-dsh-editor-writing')
  })

  it('shows ownership labels for locked cards and never a switch for session-owned entries', () => {
    const html = renderInstalledGroups()
    expect(html).toContain('由会话控制')
    expect(html).toContain('由校对功能管理')
    expect(html).toContain('必需')
    expect(html).not.toContain('plugins-toggle-include:editor-shell')
    expect(html).not.toContain('plugins-toggle-include:editor-novel-kernel')
    expect(html).not.toContain('plugins-toggle-proofread')
    expect(html.match(/role="switch"/g)).toHaveLength(5)
  })

  it('keeps real optional switches with existing test ids, aria wiring, and busy state', () => {
    const html = renderInstalledGroups()
    for (const testId of ['plugins-toggle-writing', 'plugins-toggle-zhihu', 'plugins-toggle-dsh-editor-counterfeit', 'plugins-toggle-community-theme']) {
      expect(html).toContain(`data-testid="${testId}"`)
    }
    const writingSwitch = html.indexOf('data-testid="plugins-toggle-writing"')
    expect(html.slice(Math.max(0, writingSwitch - 400), writingSwitch)).toContain('aria-checked="true"')
    expect(html.slice(Math.max(0, writingSwitch - 400), writingSwitch)).toContain('aria-labelledby="plugin-title-writing"')
    const busy = renderInstalledGroups({ busyPackage: 'dsh-manuscript' })
    const busySwitch = busy.indexOf('data-testid="plugins-toggle-writing"')
    const busyWindow = busy.slice(Math.max(0, busySwitch - 400), busySwitch + 200)
    expect(busyWindow).toContain('is-pending')
    expect(busyWindow).toContain('disabled="true"')
    expect(html).toContain('卸载')
  })

  it('renders honest empty states when nothing is listed', () => {
    const html = renderInstalledGroups({ inventory: null, presets: null })
    expect(html).toContain('未找到内置插件。')
    expect(html).toContain('没有预装插件。')
    expect(html).toContain('还没有从市场安装插件。')
    expect(html).not.toContain('role="switch"')
  })
})
