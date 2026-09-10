import { createSnapshot, listSnapshots, restoreApply, restoreCleanup, restoreProbe, rollbackSnapshot } from '../snapshot.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const snapshotHandlers = {
  'snapshot.list': {
    async run({ op }) {
      return await listSnapshots(op)
    },
  },
  'snapshot.create': {
    mutation: true,
    async run({ op, body }) {
      return await createSnapshot(op, str(body, 'label'))
    },
  },
  'snapshot.rollback': {
    mutation: true,
    async run({ op, body }) {
      return await rollbackSnapshot(op, str(body, 'snapshotId'))
    },
  },
  'snapshot.restoreProbe': {
    sessionKey: 'targetSessionId',
    async run({ op, body, resolvePeer }) {
      const sourceId = str(body, 'sourceSessionId')
      const source = sourceId ? await resolvePeer(sourceId) : undefined
      return await restoreProbe({
        source,
        target: op,
        snapshotId: str(body, 'snapshotId') || undefined,
      })
    },
  },
  'snapshot.restoreApply': {
    mutation: true,
    sessionKey: 'targetSessionId',
    async run({ op, body, resolvePeer }) {
      const source = await resolvePeer(str(body, 'sourceSessionId'))
      return await restoreApply({
        source,
        target: op,
        snapshotId: str(body, 'snapshotId'),
        token: str(body, 'token'),
      })
    },
  },
  'snapshot.restoreCleanup': {
    mutation: true,
    sessionKey: 'targetSessionId',
    async run({ op, body }) {
      return await restoreCleanup({ target: op, receiptId: str(body, 'receiptId') })
    },
  },
} satisfies WorkbenchHandlers
