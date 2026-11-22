import { defineTool } from '@deepseek-ai/dsh-tools'
import { withWorkspaceWrite } from 'dsh-manuscript/host-api'
import { WRITING_CHANGE_TOOL_NAME } from './change-contracts.ts'
import { applyWritingChange, draftGuardPaths, guardDrafts, parseWritingChange, type WritingChangeAccess } from './writing-change.ts'

/** Direct write: execute performs the change inside the workspace write queue and returns a receipt. */
export function createWritingChangeTool(resolve: (sessionId: string, signal: AbortSignal) => Promise<WritingChangeAccess>) {
  return defineTool({
    name: WRITING_CHANGE_TOOL_NAME,
    description: "Change visible project .md or .txt files immediately; the change is written when this call succeeds and the author can undo it from the chat. Read the file first. kind edit: edits[] of { oldText, newText }, each oldText an exact unique excerpt of the current file text, edits must not overlap; put every change to one file in one call and change only the passages that need it, never resend a whole chapter. oldText '' fills a file that is currently empty (single edit only). kind create: new file with complete text; never overwrites. kind split: anchor is exact unique text that starts newPath. kind merge: appends sourcePath to path, then archives sourcePath. kind renames: 1-50 { from, to } moves; the target parent must exist and the target must be absent. Fails without writing when the author has unsaved edits in a target file or the text no longer matches; read again before retrying.",
    parameters: {
      kind: { type: 'string', required: true, description: 'One of edit, create, split, merge, renames.' },
      path: { type: 'string', description: 'For edit/create/split/merge: visible project-relative .md or .txt.' },
      summary: { type: 'string', required: true, description: "Short author-facing description of what changed, in the author's language." },
      edits: {
        type: 'array',
        description: 'For edit: 1-50 replacements applied together against the current file text.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            oldText: { type: 'string', required: true },
            newText: { type: 'string', required: true },
          },
        },
      },
      text: { type: 'string', description: 'For create: complete file content.' },
      anchor: { type: 'string', description: 'For split: exact unique text where the file splits; the anchor starts newPath.' },
      newPath: { type: 'string', description: 'For split: visible project-relative .md or .txt path of the new file.' },
      sourcePath: { type: 'string', description: 'For merge: visible project-relative .md or .txt path appended to path, then archived.' },
      renames: {
        type: 'array',
        description: 'For renames: 1-50 moves of visible project-relative .md or .txt paths.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          marker: { type: 'string', required: true },
          version: { type: 'integer', required: true },
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          status: { type: 'string', required: true },
          paths: { type: 'array', required: true, items: { type: 'string' } },
          count: { type: 'integer', required: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id
      if (!sessionId) throw new Error('写作修改工具需要当前执行会话。')
      const access = await resolve(String(sessionId), exec.signal)
      const input = parseWritingChange(args)
      /* Poll drafts before taking the workspace write lock so the author's
         save is not queued behind the partner's wait. Re-check inside the lock
         without waiting. */
      await guardDrafts(access, draftGuardPaths(input), {})
      return withWorkspaceWrite(access.rootKey, async () => (
        await applyWritingChange(access, input, { draftPollMs: 0, draftTimeoutMs: 0 })
      ).receipt)
    },
  })
}
