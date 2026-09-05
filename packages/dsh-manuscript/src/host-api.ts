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
  badRequest,
  mapHostError,
  type HostRpcErr,
  type HostRpcError,
  type HostRpcIssue,
} from './rpc/host-error.ts'
