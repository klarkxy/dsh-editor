import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { Markdown } from './markdown.tsx'

function render(text: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text }))
}

describe('chat markdown renderer', () => {
  it('renders inline emphasis, code, strike, and links', () => {
    const html = render('普通 **粗体** *斜体* ~~删除~~ `代码` [官网](https://example.com)')
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<del>删除</del>')
    expect(html).toContain('<code>代码</code>')
    expect(html).toContain('<a href="https://example.com">官网</a>')
  })

  it('downgrades non-http links to plain text', () => {
    const html = render('[坏](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a')
    expect(html).toContain('坏')
  })

  it('renders headings, lists, quotes, code blocks, and rules', () => {
    const html = render('# 标题\n\n- 一\n- 二\n\n> 引用\n\n```ts\nconst x = 1\n```\n\n---')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('language-ts')
    expect(html).toContain('<hr')
  })

  it('never emits raw HTML from the model', () => {
    const html = render('<script>alert(1)</script>\n\n**安全**')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<strong>安全</strong>')
  })
})
