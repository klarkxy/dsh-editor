import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { asHost, type GrillHost, type PreToolDecision, type ToolExecLike } from './host.ts'
import { compileContext, formatCompiledContext } from './context.ts'
import {
  applySegments,
  assertLanePath,
  newProposalId,
  ProposalError,
  readTargetText,
  toWorkspaceRel,
  upsertProposal,
  type ProposalKind,
  type ProposalLane,
  type ProposalSegment,
} from './proposal.ts'
import { scanScene } from './scan.ts'
import { scaffoldNovel } from './scaffold.ts'

export const name = 'dsh-grill-tools'
export const inject = ['tools'] as const

export const SCAFFOLD_TOOL_NAME = 'scaffold_novel'
export const PROPOSE_PATCH_NAME = 'propose_patch'
export const WRITE_CHAPTER_NAME = 'write_chapter'
export const COMPILE_CONTEXT_NAME = 'compile_context'
export const SCAN_SCENE_NAME = 'scan_scene'
export const PROPOSE_CARD_NAME = 'propose_character_card_update'
export const PROPOSE_WORLD_NAME = 'propose_worldbook_update'

const PROPOSAL_TOOL_NAMES = new Set([
  PROPOSE_PATCH_NAME,
  WRITE_CHAPTER_NAME,
  PROPOSE_CARD_NAME,
  PROPOSE_WORLD_NAME,
])
const READ_TOOL_NAMES = new Set([COMPILE_CONTEXT_NAME, SCAN_SCENE_NAME])

const TOOL_DESCRIPTION =
  'Create a small novel workspace (正文/大纲/人物卡/世界书 and stub markdown files) under the current session cwd. Existing paths are skipped and never overwritten. Does not create files outside the workspace.'

const SCAFFOLD_PARAMETERS = {
  target: {
    type: 'string' as const,
    description: 'Relative directory under the session workspace. Defaults to ".".',
  },
}

export function createScaffoldTool(ctx: GrillHost) {
  return defineTool({
    name: SCAFFOLD_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: SCAFFOLD_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string' },
          created: { type: 'array', items: { type: 'string' } },
          skipped: { type: 'array', items: { type: 'string' } },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe() {
      return false
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, SCAFFOLD_TOOL_NAME)
      const resolved = resolveSandbox(ctx, exec)
      const target = typeof args.target === 'string' && args.target.trim() ? args.target : '.'
      return scaffoldNovel({
        cwd,
        target,
        mode: resolved?.mode,
        workspaceRoot: resolved?.workspaceRoot || cwd,
        signal: exec.signal,
      })
    },
  })
}

const PATCH_PARAMETERS = {
  path: {
    type: 'string' as const,
    required: true as const,
    description: 'Relative path of one existing file under the session workspace. One file per call.',
  },
  segments: {
    type: 'array' as const,
    required: true as const,
    description: 'Replacement segments. Each old_text must match the current file exactly once.',
    items: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        old_text: { type: 'string' as const, required: true as const, description: 'Exact unique substring of the current file.' },
        new_text: { type: 'string' as const, required: true as const, description: 'Replacement text.' },
      },
    },
  },
}

const CHAPTER_PARAMETERS = {
  path: {
    type: 'string' as const,
    required: true as const,
    description: 'Relative path of one existing chapter file. One file per call.',
  },
  body: {
    type: 'string' as const,
    required: true as const,
    description: 'Full chapter prose (may include a title line).',
  },
  title: {
    type: 'string' as const,
    description: 'Optional heading. Prepended as "# title" when body has no heading.',
  },
  placement: {
    type: 'string' as const,
    enum: ['replace', 'append'] as const,
    description: 'replace = whole-file draft (default). append = continue at the end of the current file.',
  },
}

function requireCwd(exec: ToolExecLike, tool: string): string {
  const cwd = exec.agent?.session?.header?.cwd
  if (!cwd) throw new Error(`${tool} requires a live agent session workspace`)
  return cwd
}

function resolveSandbox(ctx: GrillHost, exec: ToolExecLike) {
  const policy = ctx.get?.('sandboxPolicy') as GrillHost['sandboxPolicy']
  return policy?.resolve?.({ session: exec.agent?.session })
}

function parseSegments(raw: unknown): ProposalSegment[] {
  if (!Array.isArray(raw)) return []
  const out: ProposalSegment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { old_text?: unknown; new_text?: unknown }
    if (typeof row.old_text !== 'string' || typeof row.new_text !== 'string') continue
    out.push({ old_text: row.old_text, new_text: row.new_text })
  }
  return out
}

type ToolJson = Record<string, string | number | boolean | null>

async function submitProposal(
  cwd: string,
  relative: string,
  kind: ProposalKind,
  fields: { segments?: ProposalSegment[]; body?: string },
  options: { lane?: ProposalLane; allowMissing?: boolean } = {},
): Promise<ToolJson> {
  const pathRel = toWorkspaceRel(cwd, assertLanePath(relative, options.lane ?? 'prose'))
  let current = ''
  try {
    current = await readTargetText(cwd, pathRel)
  } catch (error) {
    if (!(options.allowMissing && error instanceof ProposalError && error.code === 'NOT_FOUND')) throw error
  }
  if (kind === 'patch') {
    const segments = fields.segments ?? []
    const applied = applySegments(current, segments)
    if (!applied.ok) return { error: applied.error, hint: '先读全文再提交精确且唯一的 old_text，或改用 write_chapter。' }
  }
  if (kind !== 'patch' && !(fields.body && fields.body.length)) {
    return { error: '整章稿缺少正文' }
  }
  const proposal = await upsertProposal(cwd, {
    id: newProposalId(),
    path: pathRel,
    kind,
    segments: kind === 'patch' ? fields.segments ?? [] : [],
    body: kind === 'patch' ? undefined : fields.body,
    createdAt: Date.now(),
  })
  return {
    ok: false,
    status: 'awaiting_user',
    action:
      options.lane === 'character'
        ? PROPOSE_CARD_NAME
        : options.lane === 'world'
          ? PROPOSE_WORLD_NAME
          : kind === 'patch'
            ? PROPOSE_PATCH_NAME
            : WRITE_CHAPTER_NAME,
    id: proposal.id,
    path: proposal.path,
    kind,
    segment_count: proposal.segments.length,
    note: '已写入稿纸待确认提案，作者点同意后才会改正文。在此之前不要声称已写完，也不要再发一轮确认。',
  }
}

function chapterBody(args: { body?: string; title?: string }): string {
  let body = typeof args.body === 'string' ? args.body : ''
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (title && !body.trimStart().startsWith('#')) body = `# ${title}\n\n${body}`
  return body
}

export function createProposalTools(_ctx?: GrillHost) {
  const patch = defineTool({
    name: PROPOSE_PATCH_NAME,
    description:
      'Propose a segmented edit to one existing prose file. Does not write the manuscript; the author confirms in the editor. Character cards and worldbook are not allowed. One file per call.',
    parameters: PATCH_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string' },
          path: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 15_000,
    isConcurrencySafe() {
      return false
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, PROPOSE_PATCH_NAME)
      try {
        return await submitProposal(cwd, String(args.path || ''), 'patch', { segments: parseSegments(args.segments) })
      } catch (error) {
        return mapProposalFailure(error)
      }
    },
  })

  const chapter = defineTool({
    name: WRITE_CHAPTER_NAME,
    description:
      'Propose a whole-chapter draft or an append-at-end continuation for one existing file. Does not write the manuscript; the author confirms in the editor. Character cards and worldbook are not allowed.',
    parameters: CHAPTER_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string' },
          path: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 15_000,
    isConcurrencySafe() {
      return false
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, WRITE_CHAPTER_NAME)
      const placement = args.placement === 'append' ? 'append' : 'replace'
      try {
        return await submitProposal(cwd, String(args.path || ''), placement, { body: chapterBody(args) })
      } catch (error) {
        return mapProposalFailure(error)
      }
    },
  })

  return { patch, chapter }
}

function jsonOut() {
  return {
    schema: {
      type: 'object' as const,
      additionalProperties: true,
      properties: {
        status: { type: 'string' as const },
        path: { type: 'string' as const },
        error: { type: 'string' as const },
      },
    },
    render(_args: unknown, value: unknown) {
      return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
    },
  }
}

export function createContextTool() {
  return defineTool({
    name: COMPILE_CONTEXT_NAME,
    description:
      'Pack outline, character cards, worldbook, and nearby chapter excerpts for the current workspace. Does not write files. Call before drafting or patching. Missing files are listed, never invented.',
    parameters: {
      focus: {
        type: 'string' as const,
        description: 'Chapter path (正文/….md) or a character name to prefer those cards.',
      },
      chars: {
        type: 'integer' as const,
        description: 'Soft character budget for the packed brief. Default 7000, max 12000.',
      },
    },
    output: jsonOut(),
    timeoutMs: 15_000,
    isConcurrencySafe() {
      return true
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, COMPILE_CONTEXT_NAME)
      try {
        const pack = await compileContext(cwd, {
          focus: typeof args.focus === 'string' ? args.focus : '',
          chars: typeof args.chars === 'number' ? args.chars : undefined,
        })
        return {
          outline: pack.outline,
          characters: pack.characters,
          world: pack.world,
          recent: pack.recent,
          missing: pack.missing.join('\n'),
          packed: formatCompiledContext(pack),
        }
      } catch (error) {
        return mapProposalFailure(error)
      }
    },
  })
}

export function createScanTool() {
  return defineTool({
    name: SCAN_SCENE_NAME,
    description:
      'Local heuristic scan of one prose file: long dialogue runs, generic crowd reactions, named characters who vanish. Returns candidates only; does not edit files.',
    parameters: {
      path: {
        type: 'string' as const,
        required: true as const,
        description: 'Relative path of the file to scan.',
      },
      characters: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Optional character names to track for long absences.',
      },
    },
    output: jsonOut(),
    timeoutMs: 15_000,
    isConcurrencySafe() {
      return true
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, SCAN_SCENE_NAME)
      try {
        const rel = toWorkspaceRel(cwd, String(args.path || ''))
        const text = await readTargetText(cwd, rel)
        const names = Array.isArray(args.characters)
          ? args.characters.filter((item): item is string => typeof item === 'string')
          : []
        const issues = scanScene(text, names)
        return { path: rel, count: issues.length, issues: JSON.stringify(issues) }
      } catch (error) {
        return mapProposalFailure(error)
      }
    },
  })
}

const CARD_PARAMETERS = {
  path: {
    type: 'string' as const,
    required: true as const,
    description: '人物卡/*.md',
  },
  operation: {
    type: 'string' as const,
    enum: ['create', 'patch'] as const,
    required: true as const,
    description: 'create a new card or patch an existing one. Never writes until the author confirms.',
  },
  old_text: { type: 'string' as const, description: 'Exact unique substring; required for patch.' },
  new_text: { type: 'string' as const, required: true as const, description: 'Replacement or full new card.' },
  reason: { type: 'string' as const, description: 'Why this update.' },
  source: { type: 'string' as const, description: 'Prose path or author instruction this is based on.' },
}

export function createCanonTools() {
  const card = defineTool({
    name: PROPOSE_CARD_NAME,
    description:
      'Propose a character-card create or patch. Does not write the card; the author confirms in the editor. Do not use propose_patch or write_chapter on 人物卡/.',
    parameters: CARD_PARAMETERS,
    output: jsonOut(),
    timeoutMs: 15_000,
    isConcurrencySafe() {
      return false
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, PROPOSE_CARD_NAME)
      try {
        if (args.operation === 'create') {
          return await submitProposal(cwd, String(args.path || ''), 'replace', { body: String(args.new_text || '') }, {
            lane: 'character',
            allowMissing: true,
          })
        }
        return await submitProposal(
          cwd,
          String(args.path || ''),
          'patch',
          { segments: [{ old_text: String(args.old_text || ''), new_text: String(args.new_text || '') }] },
          { lane: 'character' },
        )
      } catch (error) {
        return mapProposalFailure(error)
      }
    },
  })
  const world = defineTool({
    name: PROPOSE_WORLD_NAME,
    description:
      'Propose a worldbook create or patch. Does not write the entry; the author confirms in the editor. Do not use propose_patch or write_chapter on 世界书/.',
    parameters: {
      ...CARD_PARAMETERS,
      path: { type: 'string' as const, required: true as const, description: '世界书/*.md' },
    },
    output: jsonOut(),
    timeoutMs: 15_000,
    isConcurrencySafe() {
      return false
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec, PROPOSE_WORLD_NAME)
      try {
        if (args.operation === 'create') {
          return await submitProposal(cwd, String(args.path || ''), 'replace', { body: String(args.new_text || '') }, {
            lane: 'world',
            allowMissing: true,
          })
        }
        return await submitProposal(
          cwd,
          String(args.path || ''),
          'patch',
          { segments: [{ old_text: String(args.old_text || ''), new_text: String(args.new_text || '') }] },
          { lane: 'world' },
        )
      } catch (error) {
        return mapProposalFailure(error)
      }
    },
  })
  return { card, world }
}

function mapProposalFailure(error: unknown): ToolJson {
  if (error instanceof ProposalError) {
    return { error: error.message, code: error.code }
  }
  if (error instanceof Error) return { error: error.message }
  return { error: String(error) }
}

export function apply(ctx: Context): void {
  const host = asHost(ctx)
  const proposalTools = createProposalTools(host)
  const canon = createCanonTools()
  host.tools.register(createScaffoldTool(host))
  host.tools.register(proposalTools.patch)
  host.tools.register(proposalTools.chapter)
  host.tools.register(createContextTool())
  host.tools.register(createScanTool())
  host.tools.register(canon.card)
  host.tools.register(canon.world)
  ctx.on('tools/pre-execute' as never, ((exec: ToolExecLike, next: () => Promise<PreToolDecision>) => {
    if (exec.name === SCAFFOLD_TOOL_NAME) {
      if (!exec.agent?.session?.header?.cwd) {
        return Promise.resolve({
          kind: 'deny',
          reason: 'scaffold_novel requires a live agent session workspace',
        } satisfies PreToolDecision)
      }
      return Promise.resolve({
        kind: 'ask',
        reason: 'Create novel directories and stub files in the session workspace. Existing files are not overwritten.',
      } satisfies PreToolDecision)
    }
    const owned = PROPOSAL_TOOL_NAMES.has(exec.name) || READ_TOOL_NAMES.has(exec.name)
    if (!owned) return next()
    if (!exec.agent?.session?.header?.cwd) {
      return Promise.resolve({
        kind: 'deny',
        reason: `${exec.name} requires a live agent session workspace`,
      } satisfies PreToolDecision)
    }
    if (READ_TOOL_NAMES.has(exec.name)) {
      return Promise.resolve({ kind: 'allow' } satisfies PreToolDecision)
    }
    const resolved = resolveSandbox(host, exec)
    if (resolved?.mode === 'read-only') {
      return Promise.resolve({
        kind: 'deny',
        reason: 'sandbox is read-only',
      } satisfies PreToolDecision)
    }
    return Promise.resolve({
      kind: 'allow',
    } satisfies PreToolDecision)
  }) as never)
}
