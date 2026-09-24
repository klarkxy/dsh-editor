import type { Context } from '@deepseek-ai/cordis'
import type { FusionActor, FusionCandidate, FusionTarget } from '@klarkxy/dsh-fusion/contracts'
import type { FusionApplicationAccess, FusionApplicationPreview, FusionWritingHost } from '@klarkxy/dsh-fusion/host-contracts'
import {
  asHost, assertWritingProposalBasis, FileOpError, findUniqueIndex, MAX_TEXT_BYTES,
  parseWritingProposal, ProposalError, readTextFile, resolveWorkspaceAccess,
  withWorkspaceWrite, writeTextFile, WritingProposalError,
  type WorkspaceAccess, type WorkspaceFileContext, type WritingProposalBasis,
} from 'dsh-manuscript/host-api'
import { isWritingAgentPreset } from './host-guard.ts'
import { applyCreate, prepareCreate, type PlanningCreateProposal } from './planning-proposals.ts'

const DOMAIN = 'dsh-editor.writing'
// Positive read/research surface from the writing preset and legacy novel compositions.
// Fusion intersects this list with the actual native registry and enforces it at execution.
const WRITER_TOOLS = Object.freeze([
  'read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'skill', 'novel_knowledge', 'novel_overview',
  'novel_scratch_read', 'novel_scratch_list', 'zhihu_search', 'zhihu_global_search',
  'zhihu_hot_list', 'zhihu_ask', 'zhihu_knowledge_search',
])
const LEAD_TOOLS = new Set([
  ...WRITER_TOOLS, 'ask_user_question', 'author_observe', 'novel_memory_update',
  'novel_index_write', 'novel_scratch_write',
])
type WritingTarget = { path: string; basis?: WritingProposalBasis[] } & (
  | { kind: 'edit'; oldText: string; targetVersion: string }
  | { kind: 'create' }
)

/** Baselines always originate in the caller's read receipt, never in capture's later read. */
function parseTarget(input: unknown): WritingTarget {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WritingProposalError('A versioned writing target is required.', 'INVALID')
  const row = input as Record<string, unknown>
  const allowed = row.kind === 'edit' ? ['kind', 'path', 'oldText', 'targetVersion', 'basis'] : ['kind', 'path', 'basis']
  if ((row.kind !== 'edit' && row.kind !== 'create') || Object.keys(row).some(key => !allowed.includes(key))) {
    throw new WritingProposalError('Fusion targets accept edit or create and original read baselines only.', 'INVALID')
  }
  if (row.kind === 'edit' && typeof row.oldText !== 'string') throw new WritingProposalError('oldText must be the exact original text.', 'INVALID')
  // Use the existing V2 parser for the common visible path / receipt / basis contract.
  // The placeholder is only for validation; candidate prose never enters capture.
  const parsed = parseWritingProposal({ ...row, summary: 'Fusion',
    ...(row.kind === 'edit' ? { newText: row.oldText === '' ? ' ' : '' } : { text: ' ' }),
  })
  if (parsed.kind !== 'edit' && parsed.kind !== 'create') throw new WritingProposalError('Invalid Fusion target.', 'INVALID')
  return { kind: parsed.kind, path: parsed.path, ...(parsed.basis ? { basis: parsed.basis } : {}),
    ...(parsed.kind === 'edit' ? { oldText: parsed.oldText, targetVersion: parsed.targetVersion } : {}),
  } as WritingTarget
}

function createProposal(target: WritingTarget, text: string): PlanningCreateProposal {
  return { marker: 'dsh-editor.proposal', version: 1, writingV2: true, kind: 'create', path: target.path, summary: 'Fusion', text }
}

function replacement(before: string, target: Extract<WritingTarget, { kind: 'edit' }>, text: string): string {
  if (target.oldText === '') {
    if (before.trim() !== '') throw new ProposalError('The target is no longer empty.', 'AMBIGUOUS')
    return text
  }
  const at = findUniqueIndex(before, target.oldText)
  if (at < 0) throw new ProposalError('Original text is missing or not unique.', 'AMBIGUOUS')
  return before.slice(0, at) + text + before.slice(at + target.oldText.length)
}

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) throw new FileOpError('file too large', 'TOO_LARGE')
}

export function createFusionWritingHost(ctx: Context): FusionWritingHost {
  const host = asHost(ctx)

  async function resolve(actor: FusionActor, signal: AbortSignal, previous?: WorkspaceAccess): Promise<WorkspaceAccess> {
    signal.throwIfAborted()
    const access = await resolveWorkspaceAccess(host, actor.sessionId, signal)
    const assertIdentity = () => {
      const header = access.session.header as { cwd?: string; agentPreset?: string; parentSession?: unknown }
      if (host.sessions.get(actor.sessionId) !== access.session || String(access.session.id) !== actor.sessionId
        || actor.parentSessionId !== undefined || header.parentSession
        || header.cwd !== actor.project || !isWritingAgentPreset(header.agentPreset)) {
        throw new FileOpError('Fusion writing requires the actual root writing session and its project.', 'DENIED')
      }
    }
    assertIdentity()
    const project = await host.fs.resolve('.', { cwd: actor.project, signal })
    const policyRoot = await host.fs.resolve('.', { cwd: access.policy.workspaceRoot, signal })
    if (project.targetKey !== access.root.targetKey || policyRoot.targetKey !== access.root.targetKey
      || (access.policy.sessionId !== undefined && String(access.policy.sessionId) !== actor.sessionId)
      || (previous && (previous.root.targetKey !== access.root.targetKey || previous.workspace.path !== access.workspace.path || previous.session !== access.session))) {
      throw new FileOpError('The live workspace or sandbox no longer matches this Fusion task.', 'DENIED')
    }
    assertIdentity()
    signal.throwIfAborted()
    return access
  }

  function files(access: WorkspaceAccess, signal: AbortSignal): WorkspaceFileContext {
    return { fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal }
  }

  function checkDrafts(access: WorkspaceAccess, target: WritingTarget): void {
    const drafts = ctx.get('manuscriptDrafts') as { hasUnsaved(workspace: string, path: string): boolean } | undefined
    if (!drafts || typeof drafts.hasUnsaved !== 'function') throw new FileOpError('Draft protection is unavailable.', 'DENIED')
    for (const path of new Set([target.path, ...(target.basis ?? []).map(source => source.path)])) {
      if (drafts.hasUnsaved(access.workspace.path, path)) throw new FileOpError(`Save or discard the unsaved author draft in ${path} before adopting this candidate.`, 'DENIED')
    }
  }

  async function prepare(actor: FusionActor, access: WorkspaceAccess, target: WritingTarget, text: string, signal: AbortSignal): Promise<FusionApplicationPreview> {
    const current = await resolve(actor, signal, access)
    if (current.policy.mode === 'read-only') throw new FileOpError('The workspace is read-only.', 'DENIED')
    checkDrafts(current, target)
    const context = files(current, signal)
    await assertWritingProposalBasis(context, target.basis)
    let preview: FusionApplicationPreview
    if (target.kind === 'create') {
      await prepareCreate(context, createProposal(target, text))
      preview = { path: target.path, before: '', after: text, version: '' }
    } else {
      const before = await readTextFile(context, target.path)
      if (before.version !== target.targetVersion) throw new ProposalError('The target changed after the original read. Delegate a new target with fusion_delegate.', 'STALE')
      preview = { path: target.path, before: before.text, after: replacement(before.text, target, text), version: before.version }
    }
    checkSize(preview.after)
    checkDrafts(current, target)
    signal.throwIfAborted()
    return preview
  }

  return {
    matches: header => isWritingAgentPreset(header.agentPreset),
    writerTools: WRITER_TOOLS,
    allowLeadTool(name, args) {
      if (name === 'writing_propose' || name === 'novel_propose') {
        // Existing authority cannot distinguish outline from prose. Both text-producing
        // kinds go through fusion_delegate; structural operations keep their own guards.
        return !!args && typeof args === 'object' && ['split', 'merge', 'renames'].includes(String((args as Record<string, unknown>).kind))
      }
      return LEAD_TOOLS.has(name)
    },
    async capture(actor, input, signal) {
      actor = { ...actor }
      const target = parseTarget(input)
      const access = await resolve(actor, signal)
      return withWorkspaceWrite(access.root.targetKey, async () => {
        await prepare(actor, access, target, target.kind === 'edit' ? target.oldText : '', signal)
        return { domain: DOMAIN, data: { ...target } }
      })
    },
    async transact<T>(actor: FusionActor, envelope: FusionTarget, candidate: FusionCandidate, signal: AbortSignal, run: (access: FusionApplicationAccess) => Promise<T>): Promise<T> {
      actor = { ...actor }
      if (envelope.domain !== DOMAIN) throw new WritingProposalError('Invalid Fusion writing domain.', 'INVALID')
      const target = parseTarget(envelope.data)
      // Copy exact bytes before any await; no model or UI-supplied regeneration occurs here.
      const text = candidate.text
      if (typeof text !== 'string' || (target.kind === 'create' && !text)) throw new WritingProposalError('A non-empty create candidate is required.', 'INVALID')
      if (target.kind === 'edit' && target.oldText === text) throw new WritingProposalError('The candidate does not change the target.', 'INVALID')
      checkSize(text)
      const access = await resolve(actor, signal)
      return withWorkspaceWrite(access.root.targetKey, async () => {
        let open = true
        let committing = false
        let written = false
        const assertOpen = () => {
          signal.throwIfAborted()
          if (!open || written) throw new FileOpError('This application transaction has ended.', 'DENIED')
        }
        try {
          return await run({
            async inspect() {
              assertOpen()
              const current = await resolve(actor, signal, access)
              try { return await readTextFile(files(current, signal), target.path) }
              catch (error) { if (error instanceof FileOpError && error.code === 'NOT_FOUND') return undefined; throw error }
            },
            async prepare() { assertOpen(); return prepare(actor, access, target, text, signal) },
            async commit(expectedVersion) {
              assertOpen()
              if (committing) throw new FileOpError('A candidate application is already in progress.', 'DENIED')
              committing = true
              try {
                const preview = await prepare(actor, access, target, text, signal)
                if (expectedVersion !== preview.version) throw new ProposalError('The preview version changed.', 'STALE')
                const current = await resolve(actor, signal, access)
                const context = files(current, signal)
                // File helpers resolve and confine paths before invoking writeText. Recheck
                // live authority, drafts and all original baselines after those awaits.
                context.fs = {
                  resolve: host.fs.resolve.bind(host.fs), contains: host.fs.contains.bind(host.fs),
                  stat: host.fs.stat.bind(host.fs), lstat: host.fs.lstat.bind(host.fs),
                  readText: host.fs.readText.bind(host.fs), listDir: host.fs.listDir.bind(host.fs),
                  writeText: host.fs.writeText.bind(host.fs),
                }
                context.fs.writeText = async (destination, content, intent, writeSignal) => {
                  assertOpen()
                  const latest = await prepare(actor, access, target, text, signal)
                  if (latest.version !== expectedVersion || latest.after !== content) throw new ProposalError('The candidate baseline changed.', 'STALE')
                  const confirmed = await resolve(actor, signal, access)
                  checkDrafts(confirmed, target)
                  if (confirmed.policy.mode === 'read-only') throw new FileOpError('The workspace is read-only.', 'DENIED')
                  signal.throwIfAborted()
                  const result = await host.fs.writeText(destination, content, intent, writeSignal, confirmed.policy)
                  written = true
                  return result
                }
                const result = target.kind === 'create'
                  ? await applyCreate(context, createProposal(target, text), expectedVersion)
                  : await writeTextFile(context, target.path, preview.after, expectedVersion)
                return { path: target.path, version: result.version }
              } finally { committing = false }
            },
          })
        } finally { open = false }
      })
    },
  }
}
