import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  WRITING_PROPOSE_TOOL_NAME,
  parseWritingProposal,
} from 'dsh-manuscript/host-api'

/** Preview-only generic proposal: execute returns a serialized V2 marker and never writes. */
export function createWritingProposeTool() {
  return defineTool({
    name: WRITING_PROPOSE_TOOL_NAME,
    description: 'Propose author-previewed file changes. edit, create, split, merge, and renames accept visible project-relative .md or .txt. Never writes files. edit/split require targetVersion from the path read receipt; merge requires targetVersion and sourceVersion; each renames entry requires its source version. create has no target version and never replaces. Optional basis lists other source path/version pairs and is not a target baseline.',
    parameters: {
      kind: { type: 'string', required: true, description: 'One of edit, create, split, merge, or renames. All kinds accept visible project-relative .md or .txt.' },
      path: { type: 'string', description: 'For edit/create/split/merge: visible project-relative .md or .txt. Not used by renames.' },
      summary: { type: 'string', required: true, description: 'Short author-facing reason for this change.' },
      oldText: { type: 'string', description: 'For edit: exact unique text currently in the file. Pass an empty string to fill a file that is currently empty.' },
      newText: { type: 'string', description: 'For edit: replacement text.' },
      text: { type: 'string', description: 'For create: complete .md or .txt file content. Create is exclusive and never fills or overwrites an existing file, even if empty. Use edit with oldText \'\' to fill an existing empty file.' },
      targetVersion: { type: 'string', description: 'For edit/split/merge: exact non-empty version string from the versioned read receipt of path. Required. Create must omit this. Never invent or replace with a later read.' },
      sourceVersion: { type: 'string', description: 'For merge: exact non-empty version string from the versioned read receipt of sourcePath. Required. Other kinds must omit this.' },
      anchor: { type: 'string', description: 'For split: exact unique text where the file splits; the anchor itself starts the new file.' },
      newPath: { type: 'string', description: 'For split: visible project-relative .md or .txt path of the new file.' },
      sourcePath: { type: 'string', description: 'For merge: visible project-relative .md or .txt path whose content is appended to path, then archived.' },
      renames: {
        type: 'array',
        description: 'For renames: 1-50 entries of { from, to, version } visible project-relative .md or .txt paths. version is the source file read-receipt version. Entries may move between existing ordinary directories and rename at the same time. The target parent must already exist; never replaces an existing file.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
            version: { type: 'string', required: true },
          },
        },
      },
      basis: {
        type: 'array',
        description: 'Optional other source files this proposal depends on: { path, version, label? }. Not a substitute for targetVersion/sourceVersion/renames[].version.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            version: { type: 'string', required: true },
            label: { type: 'string' },
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
          kind: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          path: { type: 'string' },
          oldText: { type: 'string' },
          newText: { type: 'string' },
          text: { type: 'string' },
          anchor: { type: 'string' },
          newPath: { type: 'string' },
          sourcePath: { type: 'string' },
          targetVersion: { type: 'string' },
          sourceVersion: { type: 'string' },
          renames: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                from: { type: 'string', required: true },
                to: { type: 'string', required: true },
                version: { type: 'string', required: true },
              },
            },
          },
          basis: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                version: { type: 'string', required: true },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: JSON.stringify(value) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args) {
      return parseWritingProposal(args as Record<string, unknown>)
    },
  })
}
