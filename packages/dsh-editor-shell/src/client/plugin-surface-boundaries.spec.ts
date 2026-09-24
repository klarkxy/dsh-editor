import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CENTER_OVERLAYS_SLOT, EXTENSIONS_SLOT, SIDEBAR_TOOLS_SLOT } from '../root-registration.ts'
import { componentStyles } from '../styles.ts'
import { CenterOverlays, SidebarTools } from './root-columns.tsx'
import { ExtensionsDock } from './root.tsx'
import { PluginSettingsContent } from './settings.tsx'

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
    expectHostBoundary(center, 'center-overlays')
    expect(renderSlot).toHaveBeenNthCalledWith(1, SIDEBAR_TOOLS_SLOT, seatContext)
    expect(renderSlot).toHaveBeenNthCalledWith(2, CENTER_OVERLAYS_SLOT, seatContext)
    expect(renderToStaticMarkup(createElement(CenterOverlays, { show: false, renderSlot, seatContext }))).toBe('')
    expect(renderSlot).toHaveBeenCalledTimes(2)
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
    expect(componentStyles).toContain('.shell .sidebar-tools > [data-dsh-plugin-surface] > *:not(.memory-panel):not(.proofread-panel)')
  })
})
