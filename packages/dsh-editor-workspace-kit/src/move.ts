import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { LifecycleAccess } from './access.ts'
import { LifecycleError } from './errors.ts'
import { loadedDocument, safeAbsentFile, safeExistingFile } from './files.ts'

function assertWritable(access: LifecycleAccess): void {
  if (access.mode === 'read-only') throw new LifecycleError('workspace is read-only', 'READ_ONLY')
}

function minimalWindowsEnvironment(source: string, target: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: `${powershell};${path.join(systemRoot, 'System32')}`,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    DSH_MOVE_SOURCE: source,
    DSH_MOVE_TARGET: target,
  }
}

const MOVE_SCRIPT = `
try {
  [IO.File]::Move(
    [Environment]::GetEnvironmentVariable('DSH_MOVE_SOURCE'),
    [Environment]::GetEnvironmentVariable('DSH_MOVE_TARGET')
  )
  exit 0
} catch {
  $inner = $_.Exception.InnerException
  if ($inner -is [System.IO.IOException]) { exit 17 }
  if ($inner -is [System.UnauthorizedAccessException]) { exit 18 }
  exit 19
}`

export async function moveWindowsNoReplace(source: string, target: string, signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'win32') throw new LifecycleError('safe file move is unavailable on this platform', 'UNSUPPORTED')
  if (signal?.aborted) throw new LifecycleError('file move was cancelled', 'IO')
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', MOVE_SCRIPT], {
      env: minimalWindowsEnvironment(source, target),
      windowsHide: true,
      stdio: 'ignore',
    })
    let settled = false
    const timeout = globalThis.setTimeout(() => {
      child.kill()
      finish(new LifecycleError('safe file move timed out', 'IO'))
    }, 15_000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => {
      child.kill()
      finish(new LifecycleError('file move was cancelled', 'IO'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.once('error', (error) => finish(new LifecycleError('safe file move could not start', 'UNSUPPORTED', { cause: error })))
    child.once('exit', (code) => {
      if (code === 0) finish()
      else if (code === 17) finish(new LifecycleError('source is missing or destination already exists', 'EXISTS'))
      else if (code === 18) finish(new LifecycleError('file move was denied', 'READ_ONLY'))
      else finish(new LifecycleError('safe file move failed', 'IO'))
    })
  })
}

export async function moveNonWindowsNoReplace(source: string, target: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new LifecycleError('file move was cancelled', 'IO')
  const stage = path.join(path.dirname(source), `.${path.basename(source)}.${randomUUID()}.move`)
  try {
    await fs.rename(source, stage)
  } catch (error) {
    throw moveFailure(error)
  }
  try {
    await fs.link(stage, target)
  } catch (error) {
    const failure = moveFailure(error)
    await restoreStagedSource(stage, source)
    throw failure
  }
  try {
    // The staged inode is the old source; never unlink source because an editor may have recreated it.
    await fs.unlink(stage)
  } catch (error) {
    throw new LifecycleError('safe file move left a recovery staging file', 'IO', { cause: error }, stage)
  }
}

function moveFailure(error: unknown): LifecycleError {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') return new LifecycleError('source is missing or destination already exists', 'EXISTS', { cause: error })
  if (code === 'EXDEV') return new LifecycleError('safe file move requires source and target on the same filesystem', 'UNSUPPORTED', { cause: error })
  if (code === 'ENOENT') return new LifecycleError('source document was not found', 'NOT_FOUND', { cause: error })
  if (code === 'EACCES' || code === 'EPERM') return new LifecycleError('file move was denied', 'READ_ONLY', { cause: error })
  return new LifecycleError('safe file move failed', 'IO', { cause: error })
}

async function restoreStagedSource(stage: string, source: string): Promise<void> {
  try {
    await fs.link(stage, source)
  } catch (error) {
    throw new LifecycleError('safe file move could not restore the source; recover from staging path', 'STALE', { cause: error }, stage)
  }
  try {
    await fs.unlink(stage)
  } catch (error) {
    throw new LifecycleError('safe file move restored the source but left a recovery staging file', 'IO', { cause: error }, stage)
  }
}

export async function moveNoReplace(source: string, target: string, signal?: AbortSignal): Promise<void> {
  if (process.platform === 'win32') return await moveWindowsNoReplace(source, target, signal)
  return await moveNonWindowsNoReplace(source, target, signal)
}

export async function moveChecked(input: {
  access: LifecycleAccess
  source: string
  target: string
  expectedVersion: string
  expectedHash?: string
}): Promise<Awaited<ReturnType<typeof loadedDocument>>> {
  assertWritable(input.access)
  const before = await loadedDocument(input.access, input.source)
  if (!input.expectedVersion || before.version !== input.expectedVersion || (input.expectedHash && before.sha256 !== input.expectedHash)) {
    throw new LifecycleError('source document changed', 'STALE')
  }
  const source = await safeExistingFile(input.access.path, input.source)
  if (!source) throw new LifecycleError('source document was not found', 'NOT_FOUND')
  const target = await safeAbsentFile(input.access.path, input.target)
  const checked = await loadedDocument(input.access, input.source)
  if (checked.version !== before.version || checked.sha256 !== before.sha256) throw new LifecycleError('source document changed', 'STALE')
  const sourceAgain = await safeExistingFile(input.access.path, input.source)
  const targetAgain = await safeAbsentFile(input.access.path, input.target)
  if (sourceAgain !== source || targetAgain !== target) throw new LifecycleError('file path changed during move', 'STALE')

  const move = input.access.moveNoReplace ?? moveNoReplace
  try {
    await move(source, target, input.access.files.signal)
  } catch (error) {
    if (error instanceof LifecycleError && error.recoveryPath) throw error
    const postSource = await safeExistingFile(input.access.path, input.source).catch(() => undefined)
    const postTarget = await safeExistingFile(input.access.path, input.target).catch(() => undefined)
    if (postSource || !postTarget) throw error
  }
  const afterSource = await safeExistingFile(input.access.path, input.source)
  const afterTarget = await safeExistingFile(input.access.path, input.target)
  if (afterSource || !afterTarget) throw new LifecycleError('file move result is ambiguous', 'BLOCKED', undefined, afterTarget)
  const after = await loadedDocument(input.access, input.target)
  if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) {
    try {
      if (!await safeExistingFile(input.access.path, input.source)) {
        await move(afterTarget, await safeAbsentFile(input.access.path, input.source), input.access.files.signal)
      }
    } catch {
      // Preserve both observed paths; never use a destructive fallback.
    }
    throw new LifecycleError('moved document identity changed', 'STALE')
  }
  return after
}
