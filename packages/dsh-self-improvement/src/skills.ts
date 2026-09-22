import { SELF_IMPROVEMENT_PLUGIN, type MemoryRecord, type SkillRecord, type SkillSourceRef } from './contracts.ts'
import { isExpired, lessonScopeLabel } from './recall.ts'

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function skillDownloadName(id: string, title: string): string {
  const slug = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'skill'
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'id'
  return `self-improvement-${slug}-${safe}.md`
}

export function skillNameFromTitle(title: string): string {
  return title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64).toLowerCase() || 'self-improvement-lesson'
}

export function skillDescriptionFromLessons(lessons: readonly MemoryRecord[]): string {
  const first = lessons[0]
  const line = (first ? `${first.title}: ${first.content}` : 'Accepted self-improvement lessons.')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return line.slice(0, 200) || 'Accepted self-improvement lessons.'
}

export function skillSourcesFromLessons(lessons: readonly MemoryRecord[]): SkillSourceRef[] {
  return lessons.map(lesson => ({
    id: lesson.id,
    revision: lesson.revision,
    status: lesson.status,
    scope: lesson.scope,
    expiresAt: lesson.expiresAt,
  }))
}

export function sourcesMatchLive(
  sources: readonly SkillSourceRef[],
  lessons: readonly MemoryRecord[],
  now: number,
): boolean {
  if (sources.length === 0) return false
  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]))
  for (const source of sources) {
    const live = byId.get(source.id)
    if (!live || live.kind !== 'lesson') return false
    if (live.revision !== source.revision) return false
    if (live.status !== 'active' || source.status !== 'active') return false
    if (isExpired(live, now)) return false
    if (live.scope.kind !== source.scope.kind) return false
    if (live.scope.kind === 'project' && source.scope.kind === 'project' && live.scope.projectId !== source.scope.projectId) {
      return false
    }
  }
  return true
}

function provenanceYaml(lessons: readonly MemoryRecord[]): string[] {
  const lines: string[] = ['provenance:']
  for (const lesson of lessons) {
    lines.push(`  - lessonId: ${yamlScalar(lesson.id)}`)
    lines.push(`    revision: ${lesson.revision}`)
    lines.push(`    scope: ${yamlScalar(lessonScopeLabel(lesson))}`)
    lines.push(`    status: ${yamlScalar(lesson.status)}`)
    lines.push('    evidence:')
    if (lesson.evidence.length === 0) {
      lines.push('      []')
      continue
    }
    for (const ref of lesson.evidence) {
      lines.push(`      - sessionId: ${yamlScalar(ref.sessionId)}`)
      lines.push(`        seq: ${ref.seq}`)
      lines.push(`        kind: ${yamlScalar(ref.kind)}`)
    }
  }
  return lines
}

export function renderSkillMarkdown(lessons: readonly MemoryRecord[], generatedAt: number): string {
  const title = skillTitleFromLessons(lessons)
  const scopes = [...new Set(lessons.map(lessonScopeLabel))]
  const lines = [
    '---',
    `name: ${yamlScalar(skillNameFromTitle(title))}`,
    `description: ${yamlScalar(skillDescriptionFromLessons(lessons))}`,
    'source: self-improvement',
    `plugin: ${yamlScalar(SELF_IMPROVEMENT_PLUGIN)}`,
    `generatedAt: ${generatedAt}`,
    ...provenanceYaml(lessons),
    '---',
    '',
    `# ${title.replace(/[\r\n]+/g, ' ')}`,
    '',
    '## Instructions',
    '',
    'Follow these accepted lessons for the scoped work below. They are a reusable skill proposal. They are not a user request and do not authorize edits to AGENTS.md, scripts, or plugins.',
    '',
    `Scope: ${scopes.join(', ') || 'unspecified'}.`,
    '',
  ]
  for (const lesson of lessons) {
    lines.push(`### ${lesson.title.replace(/[\r\n]+/g, ' ')}`)
    lines.push('')
    lines.push(lesson.content.replace(/\r\n/g, '\n').trim())
    lines.push('')
    if (lesson.exceptions.length) {
      lines.push('Exceptions for this lesson:')
      for (const item of lesson.exceptions) lines.push(`- ${item.replace(/[\r\n]+/g, ' ')}`)
      lines.push('')
    }
  }
  lines.push('Downloading this Markdown is a local save of the proposal. It does not install the skill.')
  lines.push('')
  return lines.join('\n')
}

export function skillTitleFromLessons(lessons: readonly MemoryRecord[]): string {
  if (lessons.length === 1) return lessons[0]!.title.slice(0, 160)
  return `技能草稿（${lessons.length} 条教训）`
}

export interface SkillFrontmatter {
  name: string
  description: string
  source: string
  plugin: string
  generatedAt: number
  provenance: Array<{
    lessonId: string
    revision: number
    scope: string
    status: string
    evidence: Array<{ sessionId: string; seq: number; kind: string }>
  }>
}

function parseYamlValue(raw: string): string | number | boolean {
  const trimmed = raw.trim()
  if (trimmed === '[]') return trimmed
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed) as string } catch { return trimmed.slice(1, -1) }
  }
  return trimmed
}

/** Parses the YAML subset this package emits (quoted scalars, nested provenance lists). */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) throw new Error('missing YAML frontmatter')
  const body = match[1]!
  const seen = new Set<string>()
  let name = ''
  let description = ''
  let source = ''
  let plugin = ''
  let generatedAt = 0
  const provenance: SkillFrontmatter['provenance'] = []
  let current: SkillFrontmatter['provenance'][number] | undefined
  let evidence: { sessionId: string; seq: number; kind: string } | undefined
  for (const rawLine of body.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim() === '[]') {
      if (rawLine.trim() === '[]' && current && current.evidence.length === 0) continue
      continue
    }
    const keyMatch = rawLine.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/)
    if (keyMatch && !rawLine.startsWith(' ')) {
      const key = keyMatch[1]!
      if (seen.has(key) && key !== 'provenance') throw new Error(`duplicate YAML key ${key}`)
      seen.add(key)
      const value = parseYamlValue(keyMatch[2] ?? '')
      if (key === 'name') name = String(value)
      else if (key === 'description') description = String(value)
      else if (key === 'source') source = String(value)
      else if (key === 'plugin') plugin = String(value)
      else if (key === 'generatedAt') generatedAt = Number(value)
      continue
    }
    const item = rawLine.match(/^\s{2}-\s+lessonId:\s*(.*)$/)
    if (item) {
      current = { lessonId: String(parseYamlValue(item[1] ?? '')), revision: 0, scope: '', status: '', evidence: [] }
      provenance.push(current)
      evidence = undefined
      continue
    }
    if (!current) continue
    const field = rawLine.match(/^\s{4}(revision|scope|status|evidence)\s*:\s*(.*)$/)
    if (field) {
      const key = field[1]!
      if (key === 'revision') current.revision = Number(parseYamlValue(field[2] ?? ''))
      else if (key === 'scope') current.scope = String(parseYamlValue(field[2] ?? ''))
      else if (key === 'status') current.status = String(parseYamlValue(field[2] ?? ''))
      continue
    }
    const evidenceItem = rawLine.match(/^\s{6}-\s+sessionId:\s*(.*)$/)
    if (evidenceItem) {
      evidence = { sessionId: String(parseYamlValue(evidenceItem[1] ?? '')), seq: 0, kind: '' }
      current.evidence.push(evidence)
      continue
    }
    const evidenceField = rawLine.match(/^\s{8}(seq|kind)\s*:\s*(.*)$/)
    if (evidenceField && evidence) {
      if (evidenceField[1] === 'seq') evidence.seq = Number(parseYamlValue(evidenceField[2] ?? ''))
      else evidence.kind = String(parseYamlValue(evidenceField[2] ?? ''))
    }
  }
  if (!name || !description) throw new Error('skill frontmatter needs name and description')
  return { name, description, source, plugin, generatedAt, provenance }
}

export function downloadMarkdown(
  filename: string,
  markdown: string,
  doc: Pick<Document, 'createElement' | 'body'> | undefined = typeof document === 'undefined' ? undefined : document,
): boolean {
  if (!doc) return false
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.setAttribute('download', filename)
  anchor.rel = 'noopener'
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}

export function exportRevocationCopy(locale: 'zh' | 'en'): string {
  return locale === 'en'
    ? 'Export record revoked. Already downloaded files are not recalled.'
    : '已撤回导出记录。不会收回或删除已下载的文件。'
}

export function skillExportStateLabel(record: Pick<SkillRecord, 'exportState'>, locale: 'zh' | 'en'): string {
  if (record.exportState === 'recorded') return locale === 'en' ? 'Download recorded' : '已记录下载'
  if (record.exportState === 'revoked') return locale === 'en' ? 'Download record revoked' : '已撤回下载记录'
  return locale === 'en' ? 'Not downloaded' : '未下载'
}
