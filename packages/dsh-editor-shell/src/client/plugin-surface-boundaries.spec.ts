import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CENTER_OVERLAYS_SLOT, EXTENSIONS_SLOT, SIDEBAR_TOOLS_SLOT } from '../root-registration.ts'
import { createCommandRegistry } from '../seats.ts'
import { CenterOverlays, SidebarTools } from './root-columns.tsx'
import { ExtensionsDock } from './root.tsx'
import { PluginSettingsContent } from './settings-plugins.tsx'

const seatContext = {} as Parameters<typeof SidebarTools>[0]['seatContext']
const pluginButton = createElement('button', { className: 'rt-BaseButton' }, 'Plugin control')

function expectHostBoundary(html: string, hostClass: string) {
  expect(html).toMatch(new RegExp(`<[^>]+class="[^"]*${hostClass}[^"]*"[^>]*><div data-dsh-plugin-surface="" style="display:contents"><button`))
  expect(html.match(/data-dsh-plugin-surface/g)).toHaveLength(1)
}

describe('production plugin visual boundaries', () => {
  it('marks sidebar and center contributions while leaving their layout wrappers host-owned', () => {
    const renderSlot = vi.fn(() => pluginButton)
    const sidebar = renderToStaticMarkup(createElement(SidebarTools, { renderSlot, seatContext }))
    const center = renderToStaticMarkup(createElement(CenterOverlays, { show: true, renderSlot, seatContext }))
    expectHostBoundary(sidebar, 'sidebar-tools')
    /* §4 中央遮罩外框：插件面是弹性列里的真实布局节点；外框只给底色
       与边距，标题/关闭由插件自管。标记本身与宿主边界不变。 */
    expect(center).toMatch(/<[^>]+class="[^"]*center-overlays[^"]*"[^>]*><div class="center-overlay-surface" data-dsh-plugin-surface=""><button/)
    expect(center.match(/data-dsh-plugin-surface/g)).toHaveLength(1)
    expect(renderSlot).toHaveBeenNthCalledWith(1, SIDEBAR_TOOLS_SLOT, seatContext)
    expect(renderSlot).toHaveBeenNthCalledWith(2, CENTER_OVERLAYS_SLOT, seatContext)
    expect(renderToStaticMarkup(createElement(CenterOverlays, { show: false, renderSlot, seatContext }))).toBe('')
    expect(renderSlot).toHaveBeenCalledTimes(2)
  })

  it('fills the tools tab with openable launchers while every contribution renders null', () => {
    /* 工具贡献按「请求时才渲染」约定工作：槽位有贡献但全是 null 时，
       空态列出 `${id}-open` 命令做启动行（记忆面板 memory-open）。 */
    const commands = createCommandRegistry()
    commands.register({
      id: 'memory-open',
      group: 'writing',
      label: { zh: '记忆维护', en: 'Memory maintenance' },
      hint: { zh: '查看与撤销写作搭档自动写入的维护记录', en: 'Review partner memory updates' },
      when: 'workspace',
      run() { /* spec never clicks */ },
    })
    const entries = [{ options: { id: 'memory', order: 200, label: '记忆' } }]
    const html = renderToStaticMarkup(createElement(SidebarTools, {
      renderSlot: vi.fn(() => null),
      seatContext: { sessionId: 's1', locale: 'zh' } as never,
      entries,
      commands,
    }))
    expect(html).toContain('dsh-tools-empty')
    expect(html).toContain('还没有打开的工具')
    expect(html).toContain('记忆维护')
    expect(html).toContain('查看与撤销写作搭档自动写入的维护记录')
    expect(html).toContain('role="button"')
  })

  it('keeps the empty state non-interactive when a launcher is unavailable', () => {
    const commands = createCommandRegistry()
    commands.register({
      id: 'memory-open',
      group: 'writing',
      label: { zh: '记忆维护', en: 'Memory maintenance' },
      when: 'workspace',
      run() { /* spec never clicks */ },
    })
    const html = renderToStaticMarkup(createElement(SidebarTools, {
      renderSlot: vi.fn(() => null),
      seatContext: { sessionId: '', locale: 'zh' } as never,
      entries: [{ options: { id: 'memory', label: '记忆' } }],
      commands,
    }))
    expect(html).toContain('is-disabled')
    expect(html).not.toContain('role="button"')
  })

  it('marks extension contributions while keeping the dock geometry host-owned', () => {
    const renderSlot = vi.fn(() => pluginButton)
    const html = renderToStaticMarkup(createElement(ExtensionsDock, { rootProps: { renderSlot } }))
    expectHostBoundary(html, 'shell-extensions-dock')
    expect(renderSlot).toHaveBeenCalledWith(EXTENSIONS_SLOT, expect.any(Object))
  })

  it('marks only supplied settings contributions, leaving empty-state copy host-owned', () => {
    const contribution = renderToStaticMarkup(createElement(PluginSettingsContent, {
      contribution: pluginButton, fallback: createElement('p', null, 'Unavailable'),
    }))
    const fallback = renderToStaticMarkup(createElement(PluginSettingsContent, {
      fallback: createElement('p', null, 'Unavailable'),
    }))
    expect(contribution).toBe('<div data-dsh-plugin-surface="" style="display:contents"><button class="rt-BaseButton">Plugin control</button></div>')
    expect(fallback).toBe('<p>Unavailable</p>')
  })

  it('retains the sidebar entry animation on real contribution children', () => {
    /* 抽屉是 Portal，工具页签也可能出现在 .dsh-drawer 宿主里；规则在
       app/shell/shell.styles.ts（dsh.surfaces 层），collectStyles 读出。 */
    return import('../app/shell/shell.styles.ts').then(async () => {
      const { collectStyles } = await import('../design-system/layers.ts')
      expect(collectStyles()).toContain(':is(.shell, .dsh-drawer) .sidebar-tools > [data-dsh-plugin-surface] > *:not(.memory-panel)')
    })
  })
})
