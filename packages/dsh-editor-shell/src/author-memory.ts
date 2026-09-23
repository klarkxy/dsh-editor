import { AUTHOR_MEMORY_MAX_CHARS } from './author-preferences.ts'

/**
 * author_observe 静默写入的结构约定:作者手写内容在前;之后的自动条目以
 * AUTHOR_MEMORY_AUTO_MARKER 单独一行分界,按行追加、按行淘汰。升级前的纯文本
 * 侧写没有分界行,整体视为作者手写,永不自动清理。
 */
export const AUTHOR_MEMORY_AUTO_MARKER = 'dsh-editor.author-memory.auto'

function normalizeEntry(observation: string): string {
  return observation.replace(/\r?\n+/g, ' ').trim()
}

function splitAuthorMemory(current: string): { head: string; entries: string[] } {
  const lines = current.split('\n')
  const boundary = lines.findIndex((line) => line.trim() === AUTHOR_MEMORY_AUTO_MARKER)
  if (boundary === -1) return { head: current, entries: [] }
  return {
    head: lines.slice(0, boundary).join('\n'),
    entries: lines.slice(boundary + 1).map((line) => line.trim()).filter(Boolean),
  }
}

function composeAuthorMemory(head: string, entries: string[]): string {
  const parts = head ? [head] : []
  if (entries.length) parts.push(AUTHOR_MEMORY_AUTO_MARKER, ...entries)
  return parts.join('\n')
}

/**
 * 把一条 author_observe 观察结果追加进本机侧写,返回应写入的完整值。
 * 超限时自动丢弃最旧的自动条目腾位;手写部分永不动。返回 undefined 表示
 * 无需写入(空条目或完全重复的观察)。
 */
export function appendAuthorMemory(current: string, observation: string, maxChars = AUTHOR_MEMORY_MAX_CHARS): string | undefined {
  const entry = normalizeEntry(observation)
  if (!entry) return undefined
  const { head, entries } = splitAuthorMemory(current)
  if (entries.includes(entry)) return undefined
  const kept = [...entries, entry]
  while (kept.length > 0 && composeAuthorMemory(head, kept).length > maxChars) kept.shift()
  return composeAuthorMemory(head, kept)
}
