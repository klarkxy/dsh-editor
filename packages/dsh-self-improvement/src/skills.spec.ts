import { describe, expect, it } from 'vitest'
import { downloadMarkdown, parseSkillFrontmatter, renderSkillMarkdown, skillDownloadName } from './skills.ts'
import { lesson } from './fakes.ts'

describe('skill markdown export', () => {
  it('emits parseable YAML name/description and provenance without duplicate evidence keys', () => {
    const markdown = renderSkillMarkdown([lesson({
      id: 'les-1', title: '相对路径: "quote"', content: 'Use relative paths. Do not wrap this as a dump.', status: 'active',
      revision: 3, scope: { kind: 'project', projectId: '/novel' },
      exceptions: ['generated/'],
      evidence: [
        { sessionId: 's1#odd', seq: 9, kind: 'user', excerpt: '不对' },
        { sessionId: 's2', seq: 11, kind: 'tool' },
      ],
    })], 1_700_000_000_000)
    const parsed = parseSkillFrontmatter(markdown)
    expect(parsed.name.length).toBeGreaterThan(0)
    expect(parsed.description).toContain('相对路径')
    expect(parsed.plugin).toBe('@klarkxy/dsh-self-improvement')
    expect(parsed.provenance).toEqual([{
      lessonId: 'les-1',
      revision: 3,
      scope: 'project:/novel',
      status: 'active',
      evidence: [
        { sessionId: 's1#odd', seq: 9, kind: 'user' },
        { sessionId: 's2', seq: 11, kind: 'tool' },
      ],
    }])
    expect(markdown).toMatch(/^name:/m)
    expect(markdown).toMatch(/^description:/m)
    expect(markdown).toContain('## Instructions')
    expect(markdown).toContain('Use relative paths. Do not wrap this as a dump.')
    expect(markdown).not.toMatch(/```[\s\S]*Use relative paths/)
    expect(markdown).toContain('does not install the skill')
    expect(markdown).not.toContain('AGENTS.md has been updated')
    const evidenceKeys = markdown.match(/^\s+evidence:/gm) ?? []
    expect(evidenceKeys).toHaveLength(1)
    expect(skillDownloadName('ab/../x', 'Hello World!')).toBe('self-improvement-Hello-World-abx.md')
  })

  it('records a download only after the browser download is invoked', () => {
    expect(downloadMarkdown('x.md', '# hi')).toBe(false)
    const clicks: string[] = []
    const started = downloadMarkdown('skill.md', '# body', {
      createElement() {
        const node = {
          href: '',
          rel: '',
          attrs: {} as Record<string, string>,
          setAttribute(name: string, value: string) { this.attrs[name] = value },
          getAttribute(name: string) { return this.attrs[name] },
          click() { clicks.push(this.attrs.download ?? '') },
          remove() {},
        }
        return node as unknown as HTMLElement
      },
      body: { appendChild(node: Node) { return node } } as unknown as HTMLElement,
    } as Pick<Document, 'createElement' | 'body'>)
    expect(started).toBe(true)
    expect(clicks).toEqual(['skill.md'])
  })
})
