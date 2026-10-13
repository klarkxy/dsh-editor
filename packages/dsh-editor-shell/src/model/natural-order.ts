/*
 * 自然排序（shell-rewrite-spec §3）：按路径逐段比较；段内识别中文数字
 * （〇一二三四五六七八九十百千万两，含「第N章」「第N卷」写法）与阿拉伯数字，
 * 按数值比较；数值相同或无法识别为数字的部分退回原排序器。
 */

const FALLBACK = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

const CN_DIGIT: Readonly<Record<string, number>> = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
}
const CN_UNIT: Readonly<Record<string, number>> = { '十': 10, '百': 100, '千': 1000 }
const CN_SECTION_UNIT = '万'

function isChineseNumberChar(char: string): boolean {
  return char in CN_DIGIT || char in CN_UNIT || char === CN_SECTION_UNIT
}

function parseChineseNumber(text: string): number | null {
  if (!text) return null
  let total = 0
  let section = 0
  let digit = 0
  for (const char of text) {
    const value = CN_DIGIT[char]
    if (value !== undefined) { digit = value; continue }
    const unit = CN_UNIT[char]
    if (unit !== undefined) {
      /* 「十」起头的写法（十月、第十章）前面省略「一」。 */
      section += (digit || 1) * unit
      digit = 0
      continue
    }
    if (char === CN_SECTION_UNIT) {
      total += (section + digit) * 10000
      section = 0
      digit = 0
      continue
    }
    return null
  }
  return total + section + digit
}

type OrderToken = { kind: 'num'; value: number; raw: string } | { kind: 'text'; raw: string }

function tokenizeSegment(segment: string): OrderToken[] {
  const tokens: OrderToken[] = []
  let text = ''
  let arabic = ''
  let chinese = ''
  const flush = () => {
    if (text) { tokens.push({ kind: 'text', raw: text }); text = '' }
    if (arabic) { tokens.push({ kind: 'num', value: Number.parseInt(arabic, 10), raw: arabic }); arabic = '' }
    if (chinese) {
      const value = parseChineseNumber(chinese)
      tokens.push(value === null ? { kind: 'text', raw: chinese } : { kind: 'num', value, raw: chinese })
      chinese = ''
    }
  }
  for (const char of segment) {
    if (char >= '0' && char <= '9') {
      if (text || chinese) flush()
      arabic += char
      continue
    }
    if (isChineseNumberChar(char)) {
      if (text || arabic) flush()
      chinese += char
      continue
    }
    if (arabic || chinese) flush()
    text += char
  }
  flush()
  return tokens
}

function compareSegments(left: string, right: string): number {
  const a = tokenizeSegment(left)
  const b = tokenizeSegment(right)
  const count = Math.min(a.length, b.length)
  for (let index = 0; index < count; index += 1) {
    const tokenA = a[index]
    const tokenB = b[index]
    if (tokenA.kind === 'num' && tokenB.kind === 'num') {
      if (tokenA.value !== tokenB.value) return tokenA.value - tokenB.value
      continue
    }
    /* 数字与文字错位、或文字片段：交给原排序器（numeric 仍识别阿拉伯数字）。 */
    const diff = FALLBACK.compare(tokenA.raw, tokenB.raw)
    if (diff !== 0) return diff
  }
  return a.length - b.length
}

/** 路径逐段自然序；段数不同或各段数值相同时退回 zh-CN 排序器，保证确定性。 */
export function compareDocumentPaths(left: string, right: string): number {
  const a = left.split('/')
  const b = right.split('/')
  const count = Math.min(a.length, b.length)
  for (let index = 0; index < count; index += 1) {
    const diff = compareSegments(a[index], b[index])
    if (diff !== 0) return diff
  }
  if (a.length !== b.length) return a.length - b.length
  /* 数值相同但写法不同（第二章 / 第2章）：按原排序器比较。 */
  return FALLBACK.compare(left, right)
}
