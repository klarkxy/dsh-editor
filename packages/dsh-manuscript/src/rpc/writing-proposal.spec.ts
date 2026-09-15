import { describe, expect, it } from 'vitest'
import {
  WRITING_PROPOSAL_BASIS_MAX,
  WRITING_PROPOSAL_LABEL_MAX_CHARS,
  WRITING_PROPOSAL_VERSION_MAX_CHARS,
  WRITING_PROPOSAL_MARKER,
  WRITING_PROPOSAL_VERSION,
  WRITING_PROPOSE_TOOL_NAME,
  parseWritingProposal,
  parseWritingProposalBasis,
  parseWritingProposalMarker,
  parseWritingReceiptVersion,
} from './writing-proposal.ts'

describe('WritingProposal V2 contract', () => {
  it('publishes the generic marker, version and preview-only tool name', () => {
    expect({
      marker: WRITING_PROPOSAL_MARKER,
      version: WRITING_PROPOSAL_VERSION,
      tool: WRITING_PROPOSE_TOOL_NAME,
    }).toEqual({ marker: 'dsh-editor.proposal', version: 2, tool: 'writing_propose' })
  })

  it('parses edit/create/split/merge/renames and optional basis', () => {
    expect(parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改一句', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [{ path: 'notes/source.md', version: 'v1', label: '来源' }],
    })).toEqual({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md',
      summary: '改一句', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [{ path: 'notes/source.md', version: 'v1', label: '来源' }],
    })
    expect(parseWritingProposal({ kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新' }).kind).toBe('create')
    expect(parseWritingProposal({ kind: 'edit', path: 'notes/a.txt', summary: '改一句', oldText: '旧', newText: '新', targetVersion: 'v7' }).path).toBe('notes/a.txt')
    expect(parseWritingProposal({ kind: 'create', path: 'notes/b.txt', summary: '新建', text: 'plain' }).path).toBe('notes/b.txt')
    expect(parseWritingProposal({ kind: 'split', path: 'notes/a.md', summary: '拆', anchor: '## x', newPath: 'notes/b.md', targetVersion: 'v7' }).kind).toBe('split')
    expect(parseWritingProposal({ kind: 'split', path: 'notes/a.txt', summary: '拆', anchor: '## x', newPath: 'notes/b.txt', targetVersion: 'v7' }).path).toBe('notes/a.txt')
    expect(parseWritingProposal({ kind: 'merge', path: 'notes/a.md', summary: '合', sourcePath: 'notes/b.md', targetVersion: 'v7', sourceVersion: 'v3' }).kind).toBe('merge')
    expect(parseWritingProposal({ kind: 'merge', path: 'notes/a.txt', summary: '合', sourcePath: 'notes/b.txt', targetVersion: 'v7', sourceVersion: 'v3' }).sourcePath).toBe('notes/b.txt')
    expect(parseWritingProposal({
      kind: 'renames', summary: '改名', renames: [{ from: 'notes/a.md', to: 'notes/b.md', version: 'v7' }],
    }).kind).toBe('renames')
    expect(parseWritingProposal({
      kind: 'renames', summary: '改名并移动', renames: [{ from: 'a.txt', to: 'notes/nested/renamed.txt', version: 'v7' }],
    })).toMatchObject({ kind: 'renames', renames: [{ from: 'a.txt', to: 'notes/nested/renamed.txt', version: 'v7' }] })
    expect(parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改一句', old_text: '旧', new_string: '新', targetVersion: 'v7',
    })).toMatchObject({ oldText: '旧', newText: '新', targetVersion: 'v7' })
  })

  it('requires generation baselines per kind and rejects missing, empty, or extra fields', () => {
    expect(parseWritingReceiptVersion('v7', 'targetVersion')).toBe('v7')
    expect(() => parseWritingReceiptVersion('   ', 'targetVersion')).toThrow('version string')
    expect(() => parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新',
    })).toThrow('targetVersion')
    expect(() => parseWritingProposal({
      kind: 'split', path: 'notes/a.md', summary: '拆', anchor: '## x', newPath: 'notes/b.md',
    })).toThrow('targetVersion')
    expect(() => parseWritingProposal({
      kind: 'merge', path: 'notes/a.md', summary: '合', sourcePath: 'notes/b.md', targetVersion: 'v7',
    })).toThrow('sourceVersion')
    expect(() => parseWritingProposal({
      kind: 'renames', summary: '改名', renames: [{ from: 'notes/a.md', to: 'notes/b.md' }],
    })).toThrow('version')
    expect(() => parseWritingProposal({
      kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新', targetVersion: 'v7',
    })).toThrow('unsupported fields')
    expect(() => parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7', sourceVersion: 'v3',
    })).toThrow('unsupported fields')
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改',
      oldText: '旧', newText: '新',
    }))).toBeUndefined()
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改',
      oldText: '旧', newText: '新', targetVersion: 'v7',
    }))).toMatchObject({ targetVersion: 'v7' })
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改',
      oldText: '旧', newText: '新', targetVersion: '  v7  ',
    }))).toBeUndefined()
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'split', path: 'notes/a.md', summary: '拆',
      anchor: '## x', newPath: 'notes/b.md',
    }))).toBeUndefined()
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'merge', path: 'notes/a.md', summary: '合',
      sourcePath: 'notes/b.md', targetVersion: 'v7',
    }))).toBeUndefined()
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'renames', summary: '改名',
      renames: [{ from: 'notes/a.md', to: 'notes/b.md' }],
    }))).toBeUndefined()
    expect(() => parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新',
      targetVersion: 'v'.repeat(WRITING_PROPOSAL_VERSION_MAX_CHARS + 1),
    })).toThrow('at most')
    expect(() => parseWritingProposal({
      kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新', sourceVersion: 'v3',
    })).toThrow('unsupported fields')
  })

  it('rejects hidden, generated, absolute, traversal, and non-text V2 targets', () => {
    expect(() => parseWritingProposal({
      kind: 'edit', path: '.dsh-editor/作品索引.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
    })).toThrow('hidden')
    expect(() => parseWritingProposal({
      kind: 'create', path: 'notes/.secret.txt', summary: '新建', text: 'x',
    })).toThrow('hidden')
    expect(() => parseWritingProposal({
      kind: 'split', path: 'dist/a.md', summary: '拆', anchor: '## x', newPath: 'notes/b.md', targetVersion: 'v7',
    })).toThrow('generated')
    expect(() => parseWritingProposal({
      kind: 'renames', summary: '改名', renames: [{ from: 'notes/a.md', to: 'node_modules/b.md', version: 'v7' }],
    })).toThrow('generated')
    expect(() => parseWritingProposal({
      kind: 'merge', path: 'C:/notes/a.md', summary: '合', sourcePath: 'notes/b.md', targetVersion: 'v7', sourceVersion: 'v3',
    })).toThrow('absolute')
    expect(() => parseWritingProposal({
      kind: 'edit', path: '../secret.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
    })).toThrow('escapes')
    expect(() => parseWritingProposal({
      kind: 'create', path: 'notes/a.json', summary: '新建', text: '{}',
    })).toThrow('Markdown or text')
  })

  it('rejects hidden, generated, and non-text V2 basis sources', () => {
    expect(() => parseWritingProposalBasis([{ path: '.dsh-editor/作品索引.md', version: 'v1' }])).toThrow('hidden')
    expect(() => parseWritingProposalBasis([{ path: 'notes/.secret.md', version: 'v1' }])).toThrow('hidden')
    expect(() => parseWritingProposalBasis([{ path: 'dist/out.md', version: 'v1' }])).toThrow('generated')
    expect(() => parseWritingProposalBasis([{ path: 'node_modules/pkg.md', version: 'v1' }])).toThrow('generated')
    expect(() => parseWritingProposalBasis([{ path: 'notes/a.json', version: 'v1' }])).toThrow('Markdown or text')
    expect(() => parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改一句', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [{ path: '.dsh-editor/作品索引.md', version: 'v1' }],
    })).toThrow('hidden')
    expect(parseWritingProposalBasis([{ path: 'notes/source.txt', version: 'v1' }]))
      .toEqual([{ path: 'notes/source.txt', version: 'v1' }])
  })

  it('rejects extra fields and mismatched marker/version on the V2 parser', () => {
    expect(() => parseWritingProposal({
      kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7', extra: true,
    })).toThrow('unsupported fields')
    expect(() => parseWritingProposal({
      marker: 'other.proposal', kind: 'create', path: 'notes/a.md', summary: '新建', text: '# 新',
    })).toThrow('marker')
    expect(() => parseWritingProposal({
      version: 1, kind: 'create', path: 'notes/a.md', summary: '新建', text: '# 新',
    })).toThrow('version')
    expect(() => parseWritingProposal({
      kind: 'renames', summary: '改名', renames: [{ from: 'notes/a.md', to: 'notes/b.md', version: 'v7', extra: true }],
    })).toThrow('from, to, and version')
  })

  it('rejects frontmatter kinds and unsafe or duplicate basis', () => {
    expect(() => parseWritingProposal({ kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', beats: ['x'] })).toThrow('kind and summary')
    expect(() => parseWritingProposalBasis([{ path: '../secret.md', version: 'v1' }])).toThrow('escapes')
    expect(() => parseWritingProposalBasis([{ path: 'notes/a.md', version: '' }])).toThrow('version is required')
    expect(() => parseWritingProposalBasis([
      { path: 'notes/a.md', version: 'v1' },
      { path: 'notes/a.md', version: 'v2' },
    ])).toThrow('unique')
    expect(() => parseWritingProposalBasis(Array.from({ length: WRITING_PROPOSAL_BASIS_MAX + 1 }, (_, index) => ({
      path: `notes/${index}.md`, version: 'v1',
    })))).toThrow(`limited to ${WRITING_PROPOSAL_BASIS_MAX}`)
    expect(() => parseWritingProposalBasis([{
      path: 'notes/a.md', version: 'v1', label: 'x'.repeat(WRITING_PROPOSAL_LABEL_MAX_CHARS + 1),
    }])).toThrow('label')
  })

  it('round-trips a serialized marker and ignores V1 payloads', () => {
    const parsed = parseWritingProposal({ kind: 'create', path: 'notes/a.md', summary: '新建', text: '# 新' })
    expect(parseWritingProposalMarker(JSON.stringify(parsed))).toEqual(parsed)
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 1, kind: 'create', path: 'notes/a.md', summary: '旧', text: '# 旧',
    }))).toBeUndefined()
    expect(parseWritingProposalMarker(JSON.stringify({ ...parsed, extra: true }))).toBeUndefined()
    expect(parseWritingProposalMarker(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改',
      old_text: '旧', new_text: '新', targetVersion: 'v7',
    }))).toBeUndefined()
  })
})
