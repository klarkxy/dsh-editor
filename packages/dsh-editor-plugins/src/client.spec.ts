import { type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  apply,
  copyInstallSpec,
  discoverInstallSpec,
  handleMarketplaceGithubClick,
  listingPresentation,
  PluginDiscovery,
} from './client.tsx'
import type { MarketplaceListing } from './contracts.ts'

function collectText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node === 'object' && 'props' in node) return collectText((node as { props?: { children?: ReactNode } }).props?.children)
  return ''
}

function collectPlaceholders(node: ReactNode): string[] {
  if (node == null || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(collectPlaceholders)
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { placeholder?: unknown; children?: ReactNode } }).props
    const placeholder = typeof props?.placeholder === 'string' ? [props.placeholder] : []
    return [...placeholder, ...collectPlaceholders(props?.children)]
  }
  return []
}

function collectHrefs(node: ReactNode): string[] {
  if (node == null || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(collectHrefs)
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { href?: unknown; children?: ReactNode } }).props
    const href = typeof props?.href === 'string' ? [props.href] : []
    return [...href, ...collectHrefs(props?.children)]
  }
  return []
}

describe('plugin discovery', () => {
  it('copies npm and github specs without treating them as an Editor install API', () => {
    expect(discoverInstallSpec('npm:@klarkxy/dsh-zhihu@0.1.10')).toEqual({
      spec: 'npm:@klarkxy/dsh-zhihu@0.1.10',
      packageName: '@klarkxy/dsh-zhihu',
    })
    expect(discoverInstallSpec('github:acme/plug')).toEqual({ spec: 'github:acme/plug' })
    expect(discoverInstallSpec('普通搜索词')).toBeUndefined()
    expect(discoverInstallSpec('dsh-editor-cards')).toBeUndefined()
    expect(discoverInstallSpec('@klarkxy/dsh-web-search-manager')).toBeUndefined()
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
  })

  it('copies through the desktop clipboard bridge when present', async () => {
    const scope = globalThis as { window?: { dshWindow?: { clipboardWriteText(text: string): void | Promise<void> } }; navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }
    const previous = scope.window
    const copied: string[] = []
    scope.window = { dshWindow: { clipboardWriteText(text) { copied.push(text) } } }
    try {
      expect(await copyInstallSpec('npm:@klarkxy/dsh-zhihu@0.1.10')).toBe('@klarkxy/dsh-zhihu@0.1.10')
      await copyInstallSpec('@klarkxy/dsh-zhihu@0.1.10')
      await copyInstallSpec('github:acme/plug')
      expect(copied).toEqual(['@klarkxy/dsh-zhihu@0.1.10', '@klarkxy/dsh-zhihu@0.1.10', 'github:acme/plug'])
    } finally {
      if (previous) scope.window = previous
      else delete scope.window
    }
  })

  it('awaits a clipboard bridge Promise and throws when no clipboard exists', async () => {
    const scope = globalThis as { window?: { dshWindow?: { clipboardWriteText(text: string): void | Promise<void> } }; navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }
    const previousWindow = scope.window
    const previousNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const copied: string[] = []
    let finished = false
    scope.window = {
      dshWindow: {
        clipboardWriteText(text) {
          return Promise.resolve().then(() => {
            copied.push(text)
            finished = true
          })
        },
      },
    }
    try {
      await copyInstallSpec('link:/profile/bundled-packages/node_modules/dsh-editor-cards')
      expect(finished).toBe(true)
      expect(copied).toEqual(['link:/profile/bundled-packages/node_modules/dsh-editor-cards'])
      scope.window = {}
      Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
      await expect(copyInstallSpec('link:/profile/bundled-packages/node_modules/dsh-editor-cards')).rejects.toThrow(/剪贴板/)
    } finally {
      if (previousWindow) scope.window = previousWindow
      else delete scope.window
      if (previousNav) Object.defineProperty(globalThis, 'navigator', previousNav)
      else delete (globalThis as { navigator?: unknown }).navigator
    }
  })

  it('renders local title and origin, copies the link spec, and omits GitHub chrome', async () => {
    const local: MarketplaceListing = {
      spec: 'link:/profile/bundled-packages/node_modules/dsh-editor-cards',
      source: 'local',
      packageName: 'dsh-editor-cards',
      title: '人物卡与世界书',
      owner: '',
      repo: 'dsh-editor-cards',
      description: '卡片列表与引用',
      stars: 12,
      url: 'https://github.com/example/dsh-editor-cards',
      updatedAt: '',
      topics: [],
    }
    expect(listingPresentation(local)).toEqual({ title: '人物卡与世界书', origin: '本地发行', showStars: false })
    const tree = PluginDiscovery({
      query: '',
      listings: [local],
      searching: false,
      note: '已复制 link:/profile/bundled-packages/node_modules/dsh-editor-cards。请在官方插件页使用「添加插件」粘贴。',
      error: '',
      onQuery() {},
      onSearch() {},
      onCopy() {},
    })
    expect(tree.type).toBe('details')
    expect(tree.props.open).toBeUndefined()
    expect((Array.isArray(tree.props.children) ? tree.props.children[0] : tree.props.children)?.type).toBe('summary')
    const html = collectText(tree)
    expect(html).toContain('人物卡与世界书')
    expect(html).toContain('本地发行')
    expect(html).toContain('复制规格')
    expect(html).toContain('添加插件')
    expect(html).not.toContain('★')
    expect(html).not.toContain('在 GitHub 打开')
    expect(collectHrefs(tree)).toEqual([])
    expect(html).toContain('搜索')
    expect(html).toContain('留空点「搜索」列出本机可选包')
    expect(collectPlaceholders(tree).some((text) => text.includes('留空列出本机可选包'))).toBe(true)
    const github = listingPresentation({
      spec: 'github:acme/plug', owner: 'acme', repo: 'plug', description: '纸', stars: 3,
      url: 'https://github.com/acme/plug', updatedAt: '', topics: [],
    })
    expect(github).toMatchObject({ title: 'acme/plug', showStars: true, linkLabel: '在 GitHub 打开' })
    const scope = globalThis as { window?: { dshWindow?: { clipboardWriteText(text: string): void } } }
    const previous = scope.window
    const bridge: string[] = []
    scope.window = { dshWindow: { clipboardWriteText(text) { bridge.push(text) } } }
    try {
      await copyInstallSpec(local.spec)
      expect(bridge).toEqual([local.spec])
    } finally {
      if (previous) scope.window = previous
      else delete scope.window
    }
  })

  it('registers the discovery contribution on the editor plugins settings slot', () => {
    const registered: Array<{ spec: { name?: string }; render: unknown }> = []
    const ctx = {
      effect(run: () => unknown) { run() },
      slots: {
        inject(_key: string, callback: () => unknown) { callback() },
        register(spec: { name?: string }, render: unknown) {
          registered.push({ spec, render })
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: { presets: [], listings: [] } }) } },
    }
    apply(ctx as never)
    expect(registered.some((row) => row.spec.name === 'dsh-editor.settings.plugins')).toBe(true)
  })
})
