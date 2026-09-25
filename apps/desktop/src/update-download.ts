// Verified update transport and installation. The main process owns all paths.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app, shell, type WebContents } from 'electron'
import { buildDownloadCandidates } from './update-checker.js'
import { launchWindowsUpdate, type UpdateHelper } from './update-install.js'
import { assertUpdateFileMatches, resolveUpdateFilePath, type DownloadedUpdate, type UpdateOfferStore } from './update-session.js'

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'done'
  received: number; total: number; mirror: string; updateId?: string
}
export interface PublicDownloadedUpdate { updateId: string; filePath: string }
let activeDownload: AbortController | null = null
let installing = false
export function isUpdateBusy(): boolean { return Boolean(activeDownload || installing) }
function updateDir(): string { return join(app.getPath('temp'), 'dsh-editor-update') }
function sendProgress(sender: WebContents, progress: UpdateProgress): void {
  // Closing a renderer must not turn a verified transfer into a failed download.
  try { if (!sender.isDestroyed()) sender.send('dsh-window:update-progress', progress) } catch { /* Window closed. */ }
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function streamToFile(url: string, target: string, size: number, signal: AbortSignal,
  onProgress: (received: number, total: number) => void): Promise<void> {
  const stalled = new AbortController()
  const combined = AbortSignal.any([signal, stalled.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  const refreshTimeout = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stalled.abort(new Error('下载源长时间没有响应')), 30_000)
  }
  refreshTimeout()
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'dsh-editor' }, signal: combined })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        refreshTimeout()
        received += chunk.length
        // A proxy error or endless body must not fill the disk beyond the
        // authenticated release size. Content-Length is not a trust boundary.
        if (received > size) { callback(new Error(`文件大小超过发布记录(${size} 字节)`)); return }
        onProgress(received, size)
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), counter,
      createWriteStream(target, { flags: 'wx' }), { signal: combined })
  } finally { clearTimeout(timer) }
}
async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash, { signal })
  return hash.digest('hex')
}

/** No symlink/junction or renderer-controlled path may become an installer. */
async function checkedPath(downloaded: DownloadedUpdate): Promise<string> {
  const root = updateDir(), attempt = dirname(downloaded.path)
  if (!/^download-[a-zA-Z0-9]+$/.test(relative(root, attempt))) throw new Error('非法的更新文件路径')
  const target = resolveUpdateFilePath(attempt, downloaded.name)
  if (target !== downloaded.path) throw new Error('非法的更新文件路径')
  const directory = await lstat(attempt), file = await lstat(target)
  if (!directory.isDirectory() || directory.isSymbolicLink() || !file.isFile() || file.isSymbolicLink()) throw new Error('更新文件必须是普通文件')
  const canonicalRoot = await realpath(root), canonicalAttempt = await realpath(attempt)
  if (dirname(canonicalAttempt) !== canonicalRoot || dirname(await realpath(target)) !== canonicalAttempt) throw new Error('非法的更新文件路径')
  return target
}
async function verifyDownload(downloaded: DownloadedUpdate, store: UpdateOfferStore): Promise<string> {
  const offer = store.requireOffer(downloaded.id)
  const path = await checkedPath(downloaded)
  // Always use today's trusted offer, not a digest remembered by an old download.
  await assertUpdateFileMatches(path, offer.asset, { sha256: sha256File, size: async (file) => (await stat(file)).size })
  if (store.requireOffer(downloaded.id) !== offer) throw new Error('更新信息已变化,请重新检查更新')
  return path
}

export async function downloadUpdate(updateId: string, sender: WebContents, store: UpdateOfferStore): Promise<PublicDownloadedUpdate> {
  const offer = store.requireOffer(updateId)
  if (isUpdateBusy()) throw new Error('已有更新操作在进行中')
  const controller = new AbortController()
  activeDownload = controller
  const dir = updateDir(), errors: string[] = []
  // A failed re-download must not discard a previously verified package.
  try {
    await mkdir(dir, { recursive: true })
    for (const candidate of buildDownloadCandidates(offer.asset.url, process.env.DSH_UPDATE_MIRRORS)) {
      if (controller.signal.aborted) throw new Error('下载已取消')
      const attemptDir = await mkdtemp(join(dir, 'download-'))
      const target = resolveUpdateFilePath(attemptDir, offer.asset.name)
      const partial = `${target}.part`
      try {
        await streamToFile(candidate.url, partial, offer.asset.size, controller.signal, (received, total) => {
          sendProgress(sender, { updateId, phase: 'downloading', received, total, mirror: candidate.label })
        })
        sendProgress(sender, { updateId, phase: 'verifying', received: offer.asset.size, total: offer.asset.size, mirror: candidate.label })
        await assertUpdateFileMatches(partial, offer.asset, {
          sha256: (path) => sha256File(path, controller.signal), size: async (path) => (await stat(path)).size,
        })
        controller.signal.throwIfAborted()
        if (store.requireOffer(updateId) !== offer) throw new Error('更新信息已变化,请重新下载')
        await rename(partial, target)
        controller.signal.throwIfAborted()
        store.recordDownload({ id: offer.id, path: target, digest: offer.asset.digest, name: offer.asset.name })
        sendProgress(sender, { updateId, phase: 'done', received: offer.asset.size, total: offer.asset.size, mirror: candidate.label })
        return { updateId, filePath: target }
      } catch (error) {
        await rm(partial, { force: true }).catch(() => undefined)
        await rm(target, { force: true }).catch(() => undefined)
        await rmdir(attemptDir).catch(() => undefined)
        if (controller.signal.aborted) throw new Error('下载已取消')
        errors.push(`${candidate.label}:${errorMessage(error)}`)
        if (store.offer !== offer) break
      }
    }
    throw new Error(`所有下载源都失败了:\n${errors.join('\n')}`)
  } finally { activeDownload = null }
}
export function cancelUpdateDownload(): void { activeDownload?.abort() }

/** Restore even packages downloaded by older app versions. Disk metadata is not
 * trusted: candidates must match a fresh official offer and pass SHA-256 again. */
export async function getDownloadedUpdate(updateId: string, store: UpdateOfferStore): Promise<PublicDownloadedUpdate | null> {
  if (isUpdateBusy()) throw new Error('已有更新操作在进行中')
  const offer = store.requireOffer(updateId)
  const candidates: DownloadedUpdate[] = []
  if (store.downloaded?.id === updateId) candidates.push(store.downloaded)
  const entries = await readdir(updateDir(), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (entry.isDirectory() && /^download-[a-zA-Z0-9]+$/.test(entry.name)) candidates.push({
      id: updateId, path: resolveUpdateFilePath(join(updateDir(), entry.name), offer.asset.name), name: offer.asset.name, digest: offer.asset.digest,
    })
  }
  for (const candidate of candidates) {
    try {
      const path = await verifyDownload(candidate, store)
      // Another window may have started an operation while this file was hashed.
      if (isUpdateBusy() || store.offer !== offer) return null
      store.recordDownload(candidate)
      return { updateId, filePath: path }
    } catch { /* Missing, partial, replaced, or invalid candidates are never installed. */ }
  }
  if (store.offer === offer) store.clearDownload()
  return null
}
export async function revealDownloadedUpdate(updateId: string, store: UpdateOfferStore): Promise<void> {
  const path = await checkedPath(store.requireDownload(updateId))
  shell.showItemInFolder(path)
}
export async function openUpdateFolder(): Promise<void> {
  const dir = updateDir()
  await mkdir(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
}

export async function installUpdate(updateId: string, store: UpdateOfferStore): Promise<'restarting' | 'revealed'> {
  if (isUpdateBusy()) throw new Error('已有更新操作在进行中')
  installing = true
  let helper: UpdateHelper | undefined
  let handedOff = false
  try {
    const offer = store.requireOffer(updateId)
    const target = await verifyDownload(store.requireDownload(updateId), store)
    if (process.platform === 'darwin') { shell.showItemInFolder(target); return 'revealed' }
    if (process.platform !== 'win32') throw new Error('当前平台不支持应用内安装')
    if (app.isPackaged === false) throw new Error('开发模式不支持覆盖安装,请打开下载文件夹')
    const portable = process.env.PORTABLE_EXECUTABLE_FILE
    helper = await launchWindowsUpdate({
      mode: portable ? 'portable' : 'setup', parentPid: process.pid, source: target,
      target: portable || process.execPath, size: offer.asset.size, digest: offer.asset.digest,
    })
    // The helper has already verified/staged the file and opened the parent
    // process handle. A spawn event alone can never authorize quitting.
    await helper.commit()
    void helper.finished.then(() => { installing = false })
    app.quit()
    handedOff = true
    return 'restarting'
  } catch (error) {
    await helper?.cancel().catch(() => undefined)
    throw error
  } finally {
    // Retain the mutex if quit is delayed/vetoed; the helper has a bounded wait
    // and will leave the live application untouched when it does not exit.
    if (!handedOff) installing = false
  }
}
