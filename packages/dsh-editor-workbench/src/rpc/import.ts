import { applyImport, cleanupImport, probeImport } from '../import.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const importHandlers = {
  'project.importProbe': {
    sessionKey: 'targetSessionId',
    async run({ op, body, resolvePeer }) {
      const sourceSessionId = str(body, 'sourceSessionId')
      const source = sourceSessionId ? await resolvePeer(sourceSessionId) : undefined
      return await probeImport({ target: op, source })
    },
  },
  'project.importApply': {
    mutation: true,
    sessionKey: 'targetSessionId',
    async run({ op, body, resolvePeer }) {
      const source = await resolvePeer(str(body, 'sourceSessionId'))
      return await applyImport({ source, target: op, token: str(body, 'probeToken') })
    },
  },
  'project.importCleanup': {
    mutation: true,
    sessionKey: 'targetSessionId',
    async run({ op, body }) {
      return await cleanupImport({ target: op, receiptId: str(body, 'receiptId') })
    },
  },
} satisfies WorkbenchHandlers
