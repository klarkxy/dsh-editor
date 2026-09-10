export { LifecycleError } from './errors.ts'
export {
  workspaceOpAccess,
  type ImportAccess,
  type LifecycleAccess,
  type OverviewAccess,
  type SnapshotAccess,
  type WorkspaceOpAccess,
} from './access.ts'
export {
  assertWritableMetadata,
  ensureMetadataDirectory,
  METADATA_DIRECTORY,
  MetadataIoError,
  readMetadataText,
  writeMetadataTextAtomic,
  type MetadataAccess,
} from './metadata-io.ts'
export {
  createVisibleDirectory,
  mkdirSafe,
  RESERVED_NAME,
  validateDirectorySegment,
  validateEntryName,
  type MkdirSafeFail,
} from './entries.ts'
export {
  loadedDocument,
  lstatOptional,
  safeAbsentFile,
  safeDirectory,
  safeExistingFile,
  safeRoot,
  type LoadedText,
} from './files.ts'
export {
  moveChecked,
  moveNoReplace,
  moveNonWindowsNoReplace,
  moveWindowsNoReplace,
} from './move.ts'
export {
  GENERATED_DIRECTORIES,
  isGeneratedPath,
  isHiddenPath,
  MAX_FILES,
} from './tree.ts'
