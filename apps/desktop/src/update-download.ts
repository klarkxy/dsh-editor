// 更新的下载、校验与安装,全部跑在主进程(渲染端 CSP 不放行外网)。
//
// 渲染端只传 updateId。主进程用自己检查时记下的官方附件下载,再用 GitHub
// 发布元数据里的 digest 校验;缺摘要或校验失败就停止自动安装。镜像只加速
// 传输,不能单独提供“这份文件由我们发布”的证明。

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  const response = await fetch(url, { headers: { 'User-Agent': 'dsh-editor' }, signal })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  const source = Readable.fromWeb(response.body as unknown as WebReadableStream)
  let received = 0
  source.on('data', (chunk: Buffer | string) => {
    received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    onProgress(received, total)
  })
  await pipeline(source, createWriteStream(target))
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
  await rm(target, { force: true })
  await streamToFile(candidate.url, target, signal, (received, total) => {
    sendProgress(sender, { phase: 'downloading', received, total: total || expected.size, mirror: candidate.label })
  })
  sendProgress(sender, { phase: 'verifying', received: expected.size, total: expected.size, mirror: candidate.label })
  await assertUpdateFileMatches(target, expected, {
    sha256: sha256File,
    size: async (path) => (await stat(path)).size,
  })
  const info = await stat(target)
  sendProgress(sender, { phase: 'done', received: info.size, total: info.size, mirror: candidate.label })
}

export async function downloadUpdate(
  updateId: string,
  sender: WebContents,
  store: UpdateOfferStore,
): Promise<{ updateId: string }> {
  const offer = store.requireOffer(updateId)
  if (activeDownload) throw new Error('已有更新下载在进行中')
  const controller = new AbortController()
  activeDownload = controller
  const dir = updateDir()
  const target = resolveUpdateFilePath(dir, offer.asset.name)
  const errors: string[] = []
  try {
    await mkdir(dir, { recursive: true })
    const candidates = buildDownloadCandidates(offer.asset.url, process.env.DSH_UPDATE_MIRRORS)
    for (const candidate of candidates) {
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
        if (controller.signal.aborted) throw new Error('下载已取消')
        errors.push(`${candidate.label}:${errorMessage(error)}`)
        await rm(target, { force: true })
      }
    }
    throw new Error(`所有下载源都失败了:\n${errors.join('\n')}`)
  } finally {
    activeDownload = null
    if (controller.signal.aborted) {
      store.clearDownload()
      await rm(target, { force: true })
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
  const offer = store.requireOffer(updateId)
  const downloaded = store.requireDownload(updateId)
  const dir = updateDir()
  const target = resolveUpdateFilePath(dir, downloaded.name)
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
    const script = join(dir, 'dsh-editor-portable-update.bat')
    await writeFile(script, buildPortableSwapScript(process.pid, portableTarget, target))
    spawn('cmd.exe', ['/c', 'start', '', '/min', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else {
    spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
  app.quit()
  return 'restarting'
}
