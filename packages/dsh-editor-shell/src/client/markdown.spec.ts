import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from './markdown.tsx'

describe('chat markdown renderer', () => {
  it('parses inline emphasis, code, strike, and links', () => {
    expect(parseInline('普通 **粗体** *斜体* ~~删除~~ `代码` 结尾')).toEqual([
      '普通 ',
      { kind: 'bold', text: '粗体' },
      ' ',
      { kind: 'italic', text: '斜体' },
      ' ',
      { kind: 'strike', text: '删除' },
      ' ',
      { kind: 'code', text: '代码' },
      ' 结尾',
    ])
    expect(parseInline('[官网](https://example.com)')).toEqual([{ kind: 'link', text: '官网', href: 'https://example.com' }])
  })
  it('downgrades non-http links and keeps them as literal text', () => {
    expect(parseInline('[坏](javascript:alert(1))')).toEqual(['[坏](javascript:alert(1))'])
    expect(parseInline('[文件](file:///etc/passwd)')).toEqual(['[文件](file:///etc/passwd)'])
  })
  it('parses headings, lists, quotes, hr, and fenced code blocks', () => {
    expect(parseBlocks('## 第二节\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引文一行\n> 引文二行\n\n---\n\n```json\n{"a":1}\n```\n\n收尾段落')).toEqual([
      { kind: 'heading', level: 2, inlines: ['第二节'] },
      { kind: 'list', ordered: false, items: [['甲'], ['乙']] },
      { kind: 'list', ordered: true, items: [['一'], ['二']] },
      { kind: 'quote', inlines: ['引文一行\n引文二行'] },
      { kind: 'hr' },
      { kind: 'code', language: 'json', text: '{"a":1}' },
      { kind: 'paragraph', inlines: ['收尾段落'] },
    ])
  })
  it('keeps soft line breaks inside a paragraph and tolerates an unclosed fence', () => {
    expect(parseBlocks('第一行\n第二行')).toEqual([{ kind: 'paragraph', inlines: ['第一行\n第二行'] }])
    expect(parseBlocks('```\n流式中的代码')).toEqual([{ kind: 'code', language: '', text: '流式中的代码' }])
  })
  it('treats raw HTML as plain text instead of markup', () => {
    expect(parseBlocks('<script>alert(1)</script>')).toEqual([{ kind: 'paragraph', inlines: ['<script>alert(1)</script>'] }])
  })
})
