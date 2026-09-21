// 更新的下载、校验与安装,全部跑在主进程(渲染端 CSP 不放行外网)。
//
// 渲染端只传 updateId。主进程用自己检查时记下的官方附件下载,再用 GitHub
// 发布元数据里的 digest 校验;缺摘要或校验失败就停止自动安装。镜像只加速
// 传输,不能单独提供“这份文件由我们发布”的证明。

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app, shell, type WebContents } from 'electron'
import { buildDownloadCandidates, type DownloadCandidate } from './update-checker.js'
import { buildPortableSwapScript } from './portable-update-script.js'
import {
  assertUpdateFileMatches,
  resolveUpdateFilePath,
  type UpdateOfferStore,
} from './update-session.js'

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'done'
  received: number
  total: number
  mirror: string
}

let activeDownload: AbortController | null = null
let installing = false

function updateDir(): string {
  return join(app.getPath('temp'), 'dsh-editor-update')
}

function sendProgress(sender: WebContents, progress: UpdateProgress): void {
  if (!sender.isDestroyed()) sender.send('dsh-window:update-progress', progress)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function streamToFile(
  url: string,
  target: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
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
    const total = Number(response.headers.get('content-length')) || 0
    const source = Readable.fromWeb(response.body as unknown as WebReadableStream)
    let received = 0
    source.on('data', (chunk: Buffer | string) => {
      refreshTimeout()
      received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      onProgress(received, total)
    })
    await pipeline(source, createWriteStream(target, { flags: 'wx' }), { signal: combined })
  } finally {
    clearTimeout(timer)
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function tryCandidate(
  candidate: DownloadCandidate,
  expected: { size: number; digest: string },
  target: string,
  sender: WebContents,
  signal: AbortSignal,
): Promise<void> {
  await streamToFile(candidate.url, target, signal, (received, total) => {
    sendProgress(sender, { phase: 'downloading', received, total: total || expected.size, mirror: candidate.label })
  })
  sendProgress(sender, { phase: 'verifying', received: expected.size, total: expected.size, mirror: candidate.label })
  await assertUpdateFileMatches(target, expected, {
    sha256: sha256File,
    size: async (path) => (await stat(path)).size,
  })
  signal.throwIfAborted()
  const info = await stat(target)
  sendProgress(sender, { phase: 'done', received: info.size, total: info.size, mirror: candidate.label })
}

export async function downloadUpdate(
  updateId: string,
  sender: WebContents,
  store: UpdateOfferStore,
): Promise<{ updateId: string }> {
  const offer = store.requireOffer(updateId)
  if (activeDownload || installing) throw new Error('已有更新操作在进行中')
  const controller = new AbortController()
  activeDownload = controller
  const dir = updateDir()
  store.clearDownload()
  const errors: string[] = []
  try {
    await mkdir(dir, { recursive: true })
    const candidates = buildDownloadCandidates(offer.asset.url, process.env.DSH_UPDATE_MIRRORS)
    for (const candidate of candidates) {
      if (controller.signal.aborted) throw new Error('下载已取消')
      // 每次尝试使用独立目录，旧安装程序或杀毒软件的文件锁不影响重试。
      const attemptDir = await mkdtemp(join(dir, 'download-'))
      const target = resolveUpdateFilePath(attemptDir, offer.asset.name)
      try {
        await tryCandidate(
          candidate,
          { size: offer.asset.size, digest: offer.asset.digest },
          target,
          sender,
          controller.signal,
        )
        store.recordDownload({
          id: offer.id,
          path: target,
          digest: offer.asset.digest,
          name: offer.asset.name,
        })
        return { updateId: offer.id }
      } catch (error) {
        // 清理失败不能覆盖原错误，也不能阻止下一个下载源。
        await rm(target, { force: true }).catch(() => undefined)
        await rmdir(attemptDir).catch(() => undefined)
        if (controller.signal.aborted) throw new Error('下载已取消')
        errors.push(`${candidate.label}:${errorMessage(error)}`)
      }
    }
    throw new Error(`所有下载源都失败了:\n${errors.join('\n')}`)
  } finally {
    activeDownload = null
    if (controller.signal.aborted) {
      store.clearDownload()
    }
  }
}

export function cancelUpdateDownload(): void {
  activeDownload?.abort()
}

/**
 * 安装已下载的更新。win 安装版退出后由 NSIS 向导覆盖安装;便携版退出后由 bat
 * 脚本替换 EXE 并重启;mac 无签名做不到自替换,只打开所在文件夹交给用户。
 */
export async function installUpdate(updateId: string, store: UpdateOfferStore): Promise<'restarting' | 'revealed'> {
  if (activeDownload || installing) throw new Error('已有更新操作在进行中')
  installing = true
  try {
    const offer = store.requireOffer(updateId)
    const downloaded = store.requireDownload(updateId)
    const dir = updateDir()
    const attemptDir = dirname(downloaded.path)
    if (!/^download-[a-zA-Z0-9]+$/.test(relative(dir, attemptDir))) throw new Error('非法的更新文件路径')
    const target = resolveUpdateFilePath(attemptDir, downloaded.name)
    if (target !== downloaded.path) throw new Error('非法的更新文件路径')
    await assertUpdateFileMatches(target, { size: offer.asset.size, digest: downloaded.digest }, {
      sha256: sha256File,
      size: async (path) => (await stat(path)).size,
    })
    if (process.platform === 'darwin') {
      shell.showItemInFolder(target)
      return 'revealed'
    }
    if (process.platform !== 'win32') throw new Error('当前平台不支持应用内安装')
    const portableTarget = process.env.PORTABLE_EXECUTABLE_FILE
    if (portableTarget) {
      const script = join(attemptDir, 'dsh-editor-portable-update.bat')
      await writeFile(script, buildPortableSwapScript(process.pid, portableTarget, target))
      await launchDetached('cmd.exe', ['/d', '/c', script])
    } else {
      // NSIS 的 /D 必须是最后一个参数，且包括空格时也不能加引号。
      await launchDetached(target, [`/D=${dirname(process.execPath)}`], true)
    }
    app.quit()
    return 'restarting'
  } finally {
    installing = false
  }
}

async function launchDetached(command: string, args: string[], windowsVerbatimArguments = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}
