import type { WritingChangeEdit, WritingChangeFile, WritingChangeReceipt, WritingChangeRename } from '../writing/change-contracts.ts'

export {
  WRITING_CHANGE_MARKER,
  WRITING_CHANGE_TOOL_NAME,
  isWritingChangeReceipt,
  parseWritingChangeReceipt,
  type WritingChangeEdit,
  type WritingChangeFile,
  type WritingChangeKind,
  type WritingChangeReceipt,
  type WritingChangeRecord,
  type WritingChangeRename,
  type WritingChangeStatus,
} from '../writing/change-contracts.ts'

export type WritingChangeGetResponse = {
  receipt: WritingChangeReceipt
  files: WritingChangeFile[]
  edits?: WritingChangeEdit[]
  renames?: WritingChangeRename[]
}
