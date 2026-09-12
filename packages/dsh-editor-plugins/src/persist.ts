import { readFile, rename, rm, writeFile } from 'node:fs/promises'

export type PersistIo = {
  readFile: typeof readFile
  writeFile: typeof writeFile
  rename: typeof rename
  rm: typeof rm
}

export const defaultPersistIo: PersistIo = { readFile, writeFile, rename, rm }

export function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ENOENT')
}

export class PluginPersistBlockedError extends Error {
  readonly kind = 'persist-blocked' as const
  readonly reason: 'unmanaged-patch' | 'unreadable-patch'
  readonly detail?: string
  constructor(reason: 'unmanaged-patch' | 'unreadable-patch', detail?: string) {
    super(reason === 'unreadable-patch'
      ? '未能读取插件配置，未改动。'
      : '当前有自定义插件配置，未能保存开关。')
    this.name = 'PluginPersistBlockedError'
    this.reason = reason
    this.detail = detail
  }
}

export class PluginPersistError extends Error {
  readonly kind = 'persist-failed' as const
  readonly details: Record<string, unknown>
  constructor(message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'PluginPersistError'
    this.details = details
  }
}

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'EAGAIN'])
const MAX_ATTEMPTS = 8
const BASE_DELAY_MS = 25

export function isRetryableReplaceError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return RETRYABLE.has(String((error as { code: unknown }).code))
}

let stageSeq = 0

/** Unique tmp path. Same-PID `.${pid}.tmp` collides when two writes overlap. */
export function atomicStagePath(target: string, pid = process.pid): string {
  stageSeq += 1
  return `${target}.${pid}.${stageSeq}.${Date.now().toString(36)}.tmp`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Write `contents` then rename over `path`. Does not unlink the destination
 * first. Retries bounded EPERM/EBUSY-style failures from a watcher or
 * Windows lock; never treats those as success.
 */
export async function replaceFileAtomic(path: string, contents: string, io: PersistIo = defaultPersistIo): Promise<void> {
  const stage = atomicStagePath(path)
  await io.writeFile(stage, contents)
  let last: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await io.rename(stage, path)
      return
    } catch (error) {
      last = error
      if (!isRetryableReplaceError(error) || attempt === MAX_ATTEMPTS) {
        try { await io.rm(stage, { force: true }) } catch { /* keep original error */ }
        throw error
      }
      await wait(BASE_DELAY_MS * attempt)
    }
  }
  throw last
}

export async function writeJsonAtomic(path: string, value: unknown, io: PersistIo = defaultPersistIo): Promise<void> {
  await replaceFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, io)
}

const queues = new Map<string, Promise<unknown>>()

/** Serialize work for one home/path. Nested callers must sort keys themselves. */
export function runQueued<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  queues.set(key, run.then(() => undefined, () => undefined))
  return run
}

/** Acquire locks in sorted key order so multi-path persist cannot deadlock. */
export function runQueuedSorted<T>(keys: readonly string[], work: () => Promise<T>): Promise<T> {
  const unique = [...new Set(keys.filter(Boolean))].sort()
  if (unique.length === 0) return work()
  const run = (index: number): Promise<T> => {
    const key = unique[index]
    if (key === undefined) return work()
    return runQueued(key, () => run(index + 1))
  }
  return run(0)
}
