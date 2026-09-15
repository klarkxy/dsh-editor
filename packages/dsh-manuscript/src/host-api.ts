export {
  withWorkspaceWrite,
  WorkspaceAuthorityError,
  asHost,
  resolveWorkspaceAccess,
  type FileSystemLike,
  type FsDirEntryLike,
  type FsInfoLike,
  type FsPathInfoLike,
  type FsTargetLike,
  type FsVersionLike,
  type FsWriteIntentLike,
  type ManuscriptHost,
  type SandboxExecutionPolicyLike,
  type SessionLike,
  type WorkspaceAccess,
  type WorkspaceLike,
} from './host.ts'

export {
  FileOpError,
  MAX_TEXT_BYTES,
  createTextFile,
  listDir,
  listDirStrict,
  readTextFile,
  readTextFileLimited,
  writeTextFile,
  type DirEntry,
  type DirKind,
  type WorkspaceFileContext,
} from './rpc/files.ts'

export {
  PathConfineError,
  confineAbsolute,
  normalizeWorkspaceRelative,
  parentRelative,
} from './rpc/paths.ts'

export {
  PROJECT_RULES_TEMPLATE,
  ProjectRulesError,
  ensureProjectRules,
  readProjectRules,
  type ProjectRulesRead,
} from './rpc/project-rules.ts'

export {
  badRequest,
  mapHostError,
  type HostRpcErr,
  type HostRpcError,
  type HostRpcIssue,
} from './rpc/host-error.ts'

export {
  registerHostRpc,
  endpointFromRpcPath,
  type HostRpcContext,
  type HostRpcHandler,
} from './rpc/channel.ts'

export {
  WRITING_PROPOSAL_BASIS_MAX,
  WRITING_PROPOSAL_LABEL_MAX_CHARS,
  WRITING_PROPOSAL_MARKER,
  WRITING_PROPOSAL_PATH_MAX_CHARS,
  WRITING_PROPOSAL_RENAMES_MAX,
  WRITING_PROPOSAL_VERSION,
  WRITING_PROPOSAL_VERSION_MAX_CHARS,
  WRITING_PROPOSE_TOOL_NAME,
  WRITING_V2_CREATE,
  WritingProposalError,
  isWritingProposalV2,
  isWritingV2Create,
  parseWritingProposal,
  parseWritingProposalBasis,
  parseWritingProposalMarker,
  parseWritingReceiptVersion,
  projectRelativePath,
  type WritingProposalBasis,
  type WritingProposalRename,
  type WritingProposalV2,
} from './rpc/writing-proposal.ts'

export {
  ProposalError,
  assertWritingProposalBasis,
  parseProposal,
  type CreateProposal,
  type EditProposal,
  type Proposal,
} from './rpc/proposal.ts'
