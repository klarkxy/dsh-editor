import { resolveMemoryAccess } from '../memory/memory-access.ts'
import { changeReceipt, getWritingChange, undoWritingChange } from '../writing/writing-change.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const writingChangeHandlers = {
  'writing.change.get': {
    async run({ ctx, access, body, signal }) {
      const writing = await resolveMemoryAccess(ctx, String(access.session.id), signal)
      const record = await getWritingChange(writing, str(body, 'id'))
      return {
        receipt: changeReceipt(record),
        files: record.files,
        ...(record.edits ? { edits: record.edits } : {}),
        ...(record.renames ? { renames: record.renames } : {}),
      }
    },
  },
  'writing.change.undo': {
    mutation: true,
    async run({ ctx, access, body, signal }) {
      const writing = await resolveMemoryAccess(ctx, String(access.session.id), signal)
      return (await undoWritingChange(writing, str(body, 'id'))).receipt
    },
  },
} satisfies WorkbenchHandlers
