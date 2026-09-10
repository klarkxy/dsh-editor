import { readImageFile, type BinaryAccess } from '../binary.ts'
import {
  archiveDocument,
  copyEntry,
  deleteEntry,
  listArchives,
  moveEntry,
  moveManuscriptDocument,
  renameDocument,
  renameEntry,
  restoreArchive,
} from '../lifecycle.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const lifecycleHandlers = {
  'file.rename': {
    mutation: true,
    async run({ op, body }) {
      return await renameDocument({
        access: op,
        path: str(body, 'path'),
        newName: str(body, 'newName'),
        expectedVersion: str(body, 'expectedVersion'),
      })
    },
  },
  'file.moveManuscript': {
    mutation: true,
    async run({ op, body }) {
      return await moveManuscriptDocument({
        access: op,
        path: str(body, 'path'),
        targetDirectory: str(body, 'targetDirectory'),
        expectedVersion: str(body, 'expectedVersion'),
      })
    },
  },
  'file.readBinary': {
    async run({ host, access, body, signal }) {
      const binaryAccess: BinaryAccess = {
        fs: host.fs as BinaryAccess['fs'],
        cwd: access.workspace.path,
        root: access.root,
        policy: access.policy,
        signal,
      }
      return await readImageFile({ access: binaryAccess, path: str(body, 'path') })
    },
  },
  'archive.list': {
    async run({ op }) {
      return await listArchives(op)
    },
  },
  'archive.apply': {
    mutation: true,
    async run({ op, body }) {
      return await archiveDocument({
        access: op,
        path: str(body, 'path') || undefined,
        expectedVersion: str(body, 'expectedVersion') || undefined,
        archiveId: str(body, 'archiveId') || undefined,
      })
    },
  },
  'archive.restore': {
    mutation: true,
    async run({ op, body }) {
      return await restoreArchive({
        access: op,
        archiveId: str(body, 'archiveId'),
        expectedVersion: str(body, 'expectedVersion') || undefined,
      })
    },
  },
  'entry.copy': {
    mutation: true,
    async run({ op, body }) {
      return await copyEntry({ access: op, path: str(body, 'path'), targetDir: str(body, 'targetDir') })
    },
  },
  'entry.move': {
    mutation: true,
    async run({ op, body }) {
      return await moveEntry({ access: op, path: str(body, 'path'), targetDir: str(body, 'targetDir') })
    },
  },
  'entry.delete': {
    mutation: true,
    async run({ op, body }) {
      return await deleteEntry({ access: op, path: str(body, 'path') })
    },
  },
  'entry.rename': {
    mutation: true,
    async run({ op, body }) {
      return await renameEntry({ access: op, path: str(body, 'path'), name: str(body, 'name') })
    },
  },
} satisfies WorkbenchHandlers
