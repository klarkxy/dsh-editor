import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/* SwitchControl 是 props 回调型控件：静态渲染拿不到事件，这里换成探针捕获
   真实传参再手动触发，验证详情页把入口卡开关接到 onToggleCard。 */
let lastSwitch: Record<string, unknown> | undefined
vi.mock('../ui/index.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../ui/index.ts')>()
  return {
    ...mod,
    SwitchControl: (props: Record<string, unknown>) => {
      lastSwitch = props
      return createElement('button', {
        'type': 'button',
        'role': 'switch',
        'aria-checked': String(Boolean(props.checked)),
        'aria-label': String(props['aria-label'] ?? ''),
        'data-testid': String(props['data-testid'] ?? ''),
        'disabled': Boolean(props.disabled),
      })
    },
  }
})

import { PluginDetailPage } from './plugin-detail.tsx'
import type { PluginCatalogCard } from '../model/plugins-catalog.ts'

const SHORTCUTS = '@deepseek-ai/dsh-client-ui-shortcuts'

const entryCard = (over: Record<string, unknown> = {}): PluginCatalogCard => ({
  key: 'entry:ui-shortcuts',
  entryId: 'ui-shortcuts',
  packageName: SHORTCUTS,
  title: '快捷键',
  description: '查看和编辑当前可用的快捷键',
  badges: [],
  action: 'detail',
  ...over,
}) as PluginCatalogCard

function page(over: Record<string, unknown> = {}): string {
  lastSwitch = undefined
  return renderToStaticMarkup(createElement(PluginDetailPage, {
    packageName: SHORTCUTS,
    ctx: {} as never,
    renderSlot: () => null,
    entries: [],
    links: [],
    catalogSections: [{ id: 'official', title: 'DSH 官方插件', items: [entryCard()] }],
    legacy: { sections: [], version: 0 },
    modelSections: [],
    snapshot: { status: 'ready', bundles: [] },
    store: undefined,
    onBack() {},
    onInstall() {},
    renderModelSurface: () => null,
    configVersion: 0,
    ...(over as object),
  } as never))
}

describe('plugin detail for non-bundle catalog cards', () => {
  it('renders title, description and package name instead of 找不到这个插件', () => {
    const html = page()
    expect(html).toContain(`plugin-detail-seat-${SHORTCUTS}`)
    expect(html).toContain('快捷键')
    expect(html).toContain('查看和编辑当前可用的快捷键')
    expect(html).not.toContain('找不到这个插件')
    expect(html).toContain(SHORTCUTS)
    /* 无 bundle 时没有卸载、版本、来源行，也没有开关。 */
    expect(html).not.toContain('plugin-detail-uninstall')
    expect(html).not.toContain('plugin-detail-toggle')
  })

  it('still reports 找不到这个插件 when neither bundle nor card matches', () => {
    const html = page({ catalogSections: [{ id: 'official', title: '', items: [] }] })
    expect(html).toContain('找不到这个插件')
    expect(html).toContain(SHORTCUTS)
  })

  it('wires a switch-action entry card to onToggleCard', () => {
    const onToggleCard = vi.fn()
    const card = entryCard({ action: 'switch', enabled: false })
    page({
      catalogSections: [{ id: 'official', title: '', items: [card] }],
      onToggleCard,
    })
    expect(lastSwitch?.['data-testid']).toBe('plugin-detail-toggle')
    expect(lastSwitch?.checked).toBe(false)
    expect(lastSwitch?.disabled).toBe(false)
    ;(lastSwitch?.onCheckedChange as (enabled: boolean) => void)(true)
    expect(onToggleCard).toHaveBeenCalledExactlyOnceWith(card, true)
  })

  it('keeps the bundle-backed page shape (info rows + switch)', () => {
    const html = page({
      packageName: 'dsh-editor-cards',
      catalogSections: [{ id: 'builtin', title: '', items: [entryCard({
        key: 'bundle:dsh-editor-cards', packageName: 'dsh-editor-cards',
        entryId: 'editor-cards', title: '人物卡与世界书', description: '卡片列表与引用',
      })] }],
      snapshot: { status: 'ready', bundles: [{ name: 'dsh-editor-cards', enabled: true, installed: true, availability: 'installation', official: false, rows: [], meta: {}, version: '0.1.0' }] },
      store: { listVersionExemptions: async () => ({ ok: true, value: { exemptions: {} } }) },
    })
    expect(html).toContain('plugin-detail-seat-dsh-editor-cards')
    expect(html).toContain('人物卡与世界书')
    expect(html).not.toContain('找不到这个插件')
    expect(html).toContain('plugin-detail-toggle')
    expect(html).toContain('0.1.0')
  })
})
