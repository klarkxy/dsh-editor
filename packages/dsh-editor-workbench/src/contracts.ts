export {
  parseMemoryUpdateReceipt,
  type MemoryChange,
  type MemoryChangeSummary,
  type MemoryUpdateReceipt,
  type MemoryUpdate,
  type MemoryEvidence,
} from './memory-contracts.ts'

export type {
  CardMetaFields,
  CardRelation,
  CharacterCardFields,
  WorldbookCardFields,
} from './frontmatter.ts'

export type { ChapterMetaFields, ChapterStateFields } from './chapter-meta.ts'
export {
  CHAPTER_BEATS_MAX,
  CHAPTER_BEAT_MAX_CHARS,
  CHAPTER_STATE_KEYS,
  CHAPTER_STATE_MAX_TOTAL_CHARS,
  applyChapterMeta,
  formatChapterContextText,
  parseChapterMeta,
  stripChapterFrontmatter,
  validateChapterMeta,
} from './chapter-meta.ts'

export { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'

export {
  WORKBENCH_RPC_CHANNEL,
  type ProposalApplyResult,
  type ProposalMergePlan,
  type ProposalPayload,
  type ProposalRename,
  type ProposalRenamesPlan,
  type ProposalSplitPlan,
  type WorkbenchEndpoint,
  type WorkbenchRequestMap,
  type WorkbenchResponseMap,
  type WorkbenchRpcError,
  type WorkbenchRpcIssue,
  type WorkbenchRpcResult,
} from './contracts/channel.ts'

export type {
  ChapterStatus,
  ChapterStatusSetResponse,
  ChapterSummary,
  OutlineSummary,
  ProgressDay,
  ProgressHistory,
  ProgressRecordResult,
  ProgressWeek,
  ProjectInitResponse,
  ProjectInspectionResponse,
  ProjectOverview,
  WorkbenchPathResponse,
  WritingLogEntry,
} from './contracts/project.ts'

export type {
  CardKind,
  CardReferenceHit,
  CardsCreateRequest,
  CardsCreateResponse,
  CardsListKind,
  CardsListRequest,
  CardsListResponse,
  CardsMetaSetRequest,
  CardsMetaSetResponse,
  CardsReferencesRequest,
  CardsReferencesResponse,
  CharacterCard,
  WorldbookCard,
} from 'dsh-editor-cards/contracts'

export type { ImportProbeResponse } from './contracts/import.ts'
export type { RestoreProbeResponse, SnapshotResponse } from './contracts/snapshot.ts'
export type { ArchiveListResponse, ArchiveResponse } from './contracts/archive.ts'

export {
  PROOFREAD_KINDS,
  type ProofreadFinding,
  type ProofreadHabitStat,
  type ProofreadKind,
  type ProofreadScanRequest,
  type ProofreadScanResponse,
  type ProofreadSeverity,
} from './contracts/proofread.ts'

export {
  PROJECT_CONTEXT_CURRENT_VERSION,
  PROJECT_CONTEXT_MAX_CHARS_PER_FILE,
  PROJECT_CONTEXT_MAX_TOTAL_CHARS,
  PROJECT_CONTEXT_SCHEMA,
  PROJECT_CONTEXT_SOURCE_PATHS,
  PROJECT_CONTEXT_VERSION,
  WORLDBOOK_MAX_CHARS_PER_FILE,
  WORLDBOOK_MAX_TOTAL_CHARS,
  compileProjectContext,
  compileProjectContextV2,
  formatWorldbookTriggerLines,
  parseProjectContextEnvelope,
  parseWorldbookFrontmatter,
  parseWorldbookTriggerLines,
  projectContextReceipt,
  worldbookEditorMetadata,
  writeWorldbookFrontmatter,
  type EditorTaskEnvelope,
  type ProjectChapterContext,
  type ProjectContextCompilation,
  type ProjectContextEnvelope,
  type ProjectContextEnvelopeV1,
  type ProjectContextEnvelopeV2,
  type ProjectContextReadResult,
  type ProjectContextReceipt,
  type ProjectContextReceiptBundle,
  type ProjectContextSource,
  type ProjectContextStatus,
  type TaskContextCompilation,
  type WorldbookCandidate,
  type WorldbookEditorMetadata,
  type WorldbookMatchedBy,
  type WorldbookScanSummary,
} from './contracts/context.ts'

export { FILE_READ_BINARY_MAX_BYTES, FILE_READ_BINARY_MIME } from './contracts/binary.ts'
export type { OperationRecovery } from './contracts/recovery.ts'
