import { createElement as e, Fragment, type ReactNode } from 'react'

/*
 * 聊天回复的最小 Markdown 渲染器。刻意不用 marked/DOMPurify：
 * 模型输出不可信，这里只产出 React 文本节点，不经过 innerHTML，
 * XSS 在构造上不成立。覆盖对话高频语法：标题、段落、粗斜体、
 * 删除线、行内代码、代码块、列表、引用、链接、分隔线。
 */

export type MdInline =
  | string
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'link'; text: string; href: string }

export type MdBlock =
  | { kind: 'paragraph'; inlines: MdInline[] }
  | { kind: 'heading'; level: number; inlines: MdInline[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'quote'; inlines: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'hr' }

const INLINE_PATTERN = /(`+)([^`]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<!\w)\*([^*\n]+?)\*(?!\w)|(?<!\w)_([^_\n]+?)_(?!\w)|~~([\s\S]+?)~~|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  /* 相邻纯文本合并，避免降级链接这类场景把一个字面串拆成两个节点。 */
  const push = (value: MdInline) => {
    const tail = out[out.length - 1]
    if (typeof value === 'string' && typeof tail === 'string') out[out.length - 1] = tail + value
    else out.push(value)
  }
  INLINE_PATTERN.lastIndex = 0
  let last = 0
  for (let match = INLINE_PATTERN.exec(text); match; match = INLINE_PATTERN.exec(text)) {
    if (match.index > last) push(text.slice(last, match.index))
    const [, ticks, code, bold, boldAlt, italic, italicAlt, strike, linkText, linkHref] = match
    if (ticks) push({ kind: 'code', text: code ?? '' })
    else if (bold !== undefined || boldAlt !== undefined) push({ kind: 'bold', text: bold ?? boldAlt ?? '' })
    else if (italic !== undefined || italicAlt !== undefined) push({ kind: 'italic', text: italic ?? italicAlt ?? '' })
    else if (strike !== undefined) push({ kind: 'strike', text: strike })
    else if (linkText !== undefined && linkHref !== undefined) {
      /* 只允许 http(s) 链接；其余协议(file:, javascript:…)降级为纯文本。 */
      push(/^https?:\/\//i.test(linkHref) ? { kind: 'link', text: linkText, href: linkHref } : match[0])
    }
    last = match.index + match[0].length
  }
  if (last < text.length) push(text.slice(last))
  return out
}

const FENCE = /^```(\S*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

export function parseBlocks(text: string): MdBlock[] {
  const lines = text.split('\n')
  const blocks: MdBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) { index += 1; continue }
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) { body.push(lines[index] ?? ''); index += 1 }
      index += 1
      blocks.push({ kind: 'code', language: fence[1] ?? '', text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, inlines: parseInline(heading[2] ?? '') })
      index += 1
      continue
    }
    if (HR.test(line)) { blocks.push({ kind: 'hr' }); index += 1; continue }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (index < lines.length) {
        const quoted = QUOTE.exec(lines[index] ?? '')
        if (!quoted) break
        body.push(quoted[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'quote', inlines: parseInline(body.join('\n')) })
      continue
    }
    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line)
      const items: MdInline[][] = []
      const itemPattern = ordered ? ORDERED : UNORDERED
      while (index < lines.length) {
        const item = itemPattern.exec(lines[index] ?? '')
        if (!item) break
        items.push(parseInline(item[1] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const body: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (!current.trim()) break
      if (body.length > 0 && (FENCE.test(current) || HEADING.test(current) || QUOTE.test(current) || UNORDERED.test(current) || ORDERED.test(current) || HR.test(current))) break
      body.push(current)
      index += 1
    }
    blocks.push({ kind: 'paragraph', inlines: parseInline(body.join('\n')) })
  }
  return blocks
}

function renderInline(inlines: readonly MdInline[]): ReactNode[] {
  return inlines.map((inline, index) => {
    if (typeof inline === 'string') return inline
    const key = `i${index}`
    if (inline.kind === 'code') return e('code', { key }, inline.text)
    if (inline.kind === 'bold') return e('strong', { key }, inline.text)
    if (inline.kind === 'italic') return e('em', { key }, inline.text)
    if (inline.kind === 'strike') return e('s', { key }, inline.text)
    return e('a', { key, href: inline.href }, inline.text)
  })
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return e(Fragment, null, blocks.map((block, index) => {
    const key = `b${index}`
    switch (block.kind) {
      case 'heading':
        return e(HEADING_TAGS[Math.min(block.level, 6) - 1] ?? 'h1', { key }, ...renderInline(block.inlines))
      case 'code':
        return e('pre', { key }, e('code', block.language ? { className: `language-${block.language}` } : undefined, block.text))
      case 'quote':
        return e('blockquote', { key }, ...renderInline(block.inlines))
      case 'list':
        return e(block.ordered ? 'ol' : 'ul', { key }, block.items.map((item, at) => e('li', { key: `li${at}` }, ...renderInline(item))))
      case 'hr':
        return e('hr', { key })
      default:
        return e('p', { key }, ...renderInline(block.inlines))
    }
  }))
}
