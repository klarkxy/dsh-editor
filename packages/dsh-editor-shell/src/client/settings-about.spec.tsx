import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompletedUpdateActions } from './settings-about.tsx'

const handlers = { installing: false, onOpen() {}, onDownload() {}, onCancel() {}, onInstall() {}, onReveal() {} }
const download = { status: 'done' as const, updateId: 'verified-id', revealed: false, filePath: 'C:\\Users\\作者\\Downloads\\DSH Editor.exe' }

describe('completed update recovery actions', () => {
  it('shows the actual package path and keeps a folder action beside installation', () => {
    const html = renderToStaticMarkup(createElement(CompletedUpdateActions, {
      download, appInfo: { name: 'DSH Editor', version: '0.3.5', platform: 'win32', portable: false }, handlers,
    }))
    expect(html).toContain('DSH Editor.exe')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html.match(/<button\b/g)).toHaveLength(2)
  })
  it('still allows reopening the folder after macOS manual reveal', () => {
    const html = renderToStaticMarkup(createElement(CompletedUpdateActions, {
      download: { ...download, revealed: true }, appInfo: { name: 'DSH Editor', version: '0.3.5', platform: 'darwin', portable: false }, handlers,
    }))
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('DSH Editor.exe')
  })
  it('disables install while preparing but leaves recovery available', () => {
    const html = renderToStaticMarkup(createElement(CompletedUpdateActions, {
      download, appInfo: null, handlers: { ...handlers, installing: true },
    }))
    expect(html.match(/<button\b/g)).toHaveLength(2)
    expect(html.match(/ disabled=""/g)).toHaveLength(1)
  })
})
