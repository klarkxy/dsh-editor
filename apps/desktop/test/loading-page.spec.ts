import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadingPageDataUrl, loadingPageHtml } from '../src/loading-page.ts'

const repo = join(import.meta.dirname, '..', '..', '..')
const mascotPath = join(repo, 'apps', 'desktop', 'build', 'mascot.webp')

describe('desktop loading page', () => {
  it('embeds the mascot instead of the app mark', async () => {
    const mascot = await readFile(mascotPath)
    const html = loadingPageHtml({ firstLaunch: false, mascotBytes: mascot })
    expect(html).toContain("img-src data:")
    expect(html).toContain('class="mascot"')
    expect(html).toContain('正在启动本地写作环境…')
    expect(html).not.toContain('class="mark"')
    expect(html).not.toContain('#1a7ff0')
    const src = html.match(/src="(data:image\/webp;base64,[^"]+)"/)?.[1]
    expect(src).toBeDefined()
    const embedded = Buffer.from(src!.slice('data:image/webp;base64,'.length), 'base64')
    expect(embedded.equals(mascot)).toBe(true)
  })

  it('explains first-launch runtime copy', async () => {
    const mascot = await readFile(mascotPath)
    const html = loadingPageHtml({ firstLaunch: true, mascotBytes: mascot })
    expect(html).toContain('首次启动正在复制本地写作环境，可能需要一分钟…')
    expect(html).not.toContain('正在启动本地写作环境…')
  })

  it('wraps the page as a data URL', async () => {
    const mascot = await readFile(mascotPath)
    const url = loadingPageDataUrl({ firstLaunch: false, mascotBytes: mascot })
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))
    expect(html).toContain('class="mascot"')
    expect(html).toContain('data:image/webp;base64,')
  })
})
