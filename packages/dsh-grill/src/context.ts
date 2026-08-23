import fs from 'node:fs/promises'
import path from 'node:path'
import { confinePath, PathConfineError, toPosixRelative } from './paths.ts'

export const DEFAULT_CONTEXT_CHARS = 7000
export const MAX_CONTEXT_CHARS = 12_000

export type CompiledContext = {
  outline: string
  characters: string
  world: string
  recent: string
  missing: string[]
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

async function readOptional(cwd: string, relative: string): Promise<string | null> {
  const abs = confinePath(cwd, relative)
  try {
    const buf = await fs.readFile(abs)
    if (buf.includes(0)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

async function listMarkdown(cwd: string, relative: string): Promise<string[]> {
  const abs = confinePath(cwd, relative)
  try {
    const names = await fs.readdir(abs)
    return names.filter((name) => name.endsWith('.md') && !name.startsWith('.')).sort((a, b) => a.localeCompare(b, 'zh'))
  } catch {
    return []
  }
}

export function extractHeadingSection(text: string, heading: string): string | null {
  const re = new RegExp(`^##\\s*${heading}\\s*$`, 'm')
  const match = text.match(re)
  if (!match || match.index == null) return null
  const start = match.index + match[0].length
  const rest = text.slice(start)
  const next = rest.search(/^##\s+/m)
  const body = (next < 0 ? rest : rest.slice(0, next)).trim()
  return body || null
}

function looksLikePath(focus: string): boolean {
  return focus.includes('/') || focus.includes('\\') || focus.endsWith('.md')
}

export async function compileContext(
  cwd: string,
  options: { focus?: string; chars?: number } = {},
): Promise<CompiledContext> {
  if (!cwd) throw new PathConfineError('workspace cwd is required')
  const cap = Math.min(MAX_CONTEXT_CHARS, Math.max(800, options.chars ?? DEFAULT_CONTEXT_CHARS))
  const missing: string[] = []
  const focus = options.focus?.trim() || ''

  const outlineRaw = await readOptional(cwd, '大纲/总纲.md')
  if (outlineRaw == null) missing.push('大纲/总纲.md')

  const cardNames = await listMarkdown(cwd, '人物卡')
  if (!cardNames.length) missing.push('人物卡/')
  const indexRaw = await readOptional(cwd, '人物卡/人物索引.md')
  let wanted = cardNames
  if (focus && !looksLikePath(focus)) {
    const hit = cardNames.filter((name) => name.replace(/\.md$/i, '').includes(focus))
    if (hit.length) wanted = hit
    else missing.push(`人物卡/${focus}`)
  }
  const cardBits: string[] = []
  if (indexRaw && (!focus || looksLikePath(focus))) cardBits.push(clip(indexRaw, 800))
  for (const name of wanted) {
    if (name === '人物索引.md' && cardBits.length) continue
    const body = await readOptional(cwd, `人物卡/${name}`)
    if (body == null) continue
    const budget = focus && !looksLikePath(focus) && wanted.length <= 2 ? 1800 : 500
    cardBits.push(`# ${name.replace(/\.md$/i, '')}\n${clip(body, budget)}`)
  }

  const worldRaw = await readOptional(cwd, '世界书/设定总汇.md')
  if (worldRaw == null) missing.push('世界书/设定总汇.md')
  const worldConfirmed = worldRaw ? extractHeadingSection(worldRaw, '已确认') : null

  let recent = ''
  if (focus && looksLikePath(focus)) {
    const rel = toPosixRelative(cwd, confinePath(cwd, focus))
    const current = await readOptional(cwd, rel)
    if (current == null) missing.push(rel)
    else {
      const head = clip(current, 600)
      const tail = current.length > 900 ? clip(current.slice(-700), 700) : ''
      recent = tail && tail !== head ? `${head}\n…\n${tail}` : head
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'
      const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
      const siblings = await listMarkdown(cwd, dir)
      const index = siblings.indexOf(base)
      if (index > 0) {
        const prevRel = dir === '.' ? siblings[index - 1] : `${dir}/${siblings[index - 1]}`
        const prev = await readOptional(cwd, prevRel)
        if (prev) recent = `上一篇 ${prevRel} 结尾：\n${clip(prev.slice(-500), 500)}\n\n本篇：\n${recent}`
      }
    }
  }

  const outlineBudget = Math.floor(cap * 0.2)
  const charBudget = Math.floor(cap * 0.35)
  const worldBudget = Math.floor(cap * 0.25)
  const recentBudget = cap - outlineBudget - charBudget - worldBudget

  return {
    outline: clip(outlineRaw || '', outlineBudget),
    characters: clip(cardBits.join('\n\n'), charBudget),
    world: clip(worldConfirmed || worldRaw || '', worldBudget),
    recent: clip(recent, recentBudget),
    missing,
  }
}

export function formatCompiledContext(pack: CompiledContext): string {
  const parts = [
    pack.outline && `## 大纲\n${pack.outline}`,
    pack.characters && `## 人物\n${pack.characters}`,
    pack.world && `## 世界书\n${pack.world}`,
    pack.recent && `## 近章\n${pack.recent}`,
    pack.missing.length && `## 缺口\n${pack.missing.join('\n')}`,
  ].filter(Boolean)
  return parts.join('\n\n')
}
