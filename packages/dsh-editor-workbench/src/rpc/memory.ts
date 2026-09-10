import { compileContext } from '../context.ts'
import { resolveMemoryAccess } from '../memory-access.ts'
import { applyMemoryChange, getMemoryChange, listMemoryChanges, undoMemoryChange } from '../memory.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const memoryHandlers = {
  'memory.list': {
    async run({ ctx, access, signal }) {
      const memory = await resolveMemoryAccess(ctx, String(access.session.id), signal)
      return await listMemoryChanges(memory)
    },
  },
  'memory.get': {
    async run({ ctx, access, body, signal }) {
      const memory = await resolveMemoryAccess(ctx, String(access.session.id), signal)
      return { record: await getMemoryChange(memory, str(body, 'id')) }
    },
  },
  'memory.apply': {
    mutation: true,
    async run({ ctx, access, body, signal }) {
      const memory = await resolveMemoryAccess(ctx, String(access.session.id), signal)
      return await applyMemoryChange(memory, str(body, 'id'))
    },
  },
  'memory.undo': {
    mutation: true,
    async run({ ctx, access, body, signal }) {
      const memory = await resolveMemoryAccess(ctx, String(access.session.id), signal)
      return await undoMemoryChange(memory, str(body, 'id'))
    },
  },
  'context.compile': {
    async run({ files, body }) {
      return await compileContext(
        files,
        str(body, 'userRequest'),
        str(body, 'activePath') || undefined,
        str(body, 'authorPreferences'),
        str(body, 'authorMemory'),
      )
    },
  },
} satisfies WorkbenchHandlers
