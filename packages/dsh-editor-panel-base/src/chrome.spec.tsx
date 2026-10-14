import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  PanelEmpty,
  PanelHeader,
  PanelList,
  PanelNotice,
  PanelRow,
  PanelSection,
  panelChromeStyles,
} from './chrome.tsx'

describe('panel chrome', () => {
  it('PanelHeader renders title, description and an accessible close control', () => {
    const html = renderToStaticMarkup(
      createElement(PanelHeader, { title: '记忆维护', description: 'desc', onClose: () => {}, closeLabel: '关闭' }),
    )
    expect(html).toContain('dsh-panel-header')
    expect(html).toContain('<h2>记忆维护</h2>')
    expect(html).toContain('<p>desc</p>')
    expect(html).toContain('aria-label="关闭"')
    expect(html).toContain('icon-button')
  })

  it('PanelHeader omits the close control without onClose', () => {
    const html = renderToStaticMarkup(createElement(PanelHeader, { title: 'T' }))
    expect(html).not.toContain('dsh-panel-close')
    expect(html).not.toContain('<p>')
  })

  it('PanelSection renders the h3 label and passes aria-label through', () => {
    const html = renderToStaticMarkup(
      createElement(PanelSection, { label: '章节', 'aria-label': 'chapter list', children: createElement('i') }),
    )
    expect(html).toContain('dsh-panel-section')
    expect(html).toContain('<h3>章节</h3>')
    expect(html).toContain('aria-label="chapter list"')
  })

  it('PanelList honours ordered lists and keeps list classes', () => {
    expect(renderToStaticMarkup(createElement(PanelList, { ordered: true, className: 'x' }))).toContain('<ol')
    expect(renderToStaticMarkup(createElement(PanelList, { className: 'x' }))).toContain('<ul')
    expect(renderToStaticMarkup(createElement(PanelList, null))).toContain('dsh-panel-list')
    expect(renderToStaticMarkup(createElement(PanelRow, null))).toContain('dsh-panel-row')
  })

  it('PanelNotice maps tone to data-tone and keeps role', () => {
    const danger = renderToStaticMarkup(createElement(PanelNotice, { tone: 'danger', role: 'alert', children: 'x' }))
    expect(danger).toContain('data-tone="danger"')
    expect(danger).toContain('role="alert"')
    const muted = renderToStaticMarkup(createElement(PanelNotice, { children: 'x' }))
    expect(muted).toContain('data-tone="muted"')
  })

  it('PanelEmpty renders the quiet empty state', () => {
    expect(renderToStaticMarkup(createElement(PanelEmpty, { children: 'none' }))).toContain('dsh-panel-empty')
  })

  it('chrome styles carry no literal colours, shadows or !important', () => {
    expect(panelChromeStyles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(panelChromeStyles).not.toMatch(/\brgba?\(/)
    expect(panelChromeStyles).not.toMatch(/!important/)
    expect(panelChromeStyles).not.toMatch(/box-shadow\s*:\s*["']?(?:inset\s+)?-?\d/i)
    expect(panelChromeStyles).toContain('.dsh-panel {')
    expect(panelChromeStyles).toContain('prefers-reduced-motion')
    expect(panelChromeStyles).toContain('forced-colors')
  })
})
