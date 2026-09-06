// 更新的下载、校验与安装,全部跑在主进程(渲染端 CSP 不放行外网)。
//
// 下载按 buildDownloadCandidates 的顺序尝试:镜像在前、直连兜底;每个候选失败
// (HTTP 错误/网络中断/大小不符/SHA-256 不符)删掉残留换下一个。校验和来自
// release 里随产物上传的 sha256sums.txt——镜像可能被劫持,光有大小不够;
// 旧 release 没有这个文件时降级为只校验大小。

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app, shell, type WebContents } from 'electron'
import {
  buildDownloadCandidates,
  parseSha256Sums,
  type DownloadCandidate,
  type UpdateAsset,
} from './update-checker.js'
import { buildPortableSwapScript } from './portable-update-script.js'

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'done'
  received: number
  total: number
  mirror: string
}

const SUMS_FILENAME = 'sha256sums.txt'

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

/** 拉 release 同目录的 sha256sums.txt;所有候选都拿不到(含旧 release 404)返回 null。 */
async function fetchSums(assetUrl: string, signal: AbortSignal): Promise<Map<string, string> | null> {
  const sumsUrl = assetUrl.slice(0, assetUrl.lastIndexOf('/') + 1) + SUMS_FILENAME
  for (const candidate of buildDownloadCandidates(sumsUrl, process.env.DSH_UPDATE_MIRRORS)) {
    try {
      const response = await fetch(candidate.url, { headers: { 'User-Agent': 'dsh-editor' }, signal })
      if (!response.ok) continue
      return parseSha256Sums(await response.text())
    } catch {
      if (signal.aborted) return null
    }
  }
  return null
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function tryCandidate(
  candidate: DownloadCandidate,
  asset: UpdateAsset,
  target: string,
  sums: Map<string, string> | null,
  sender: WebContents,
  signal: AbortSignal,
): Promise<void> {
  await rm(target, { force: true })
  await streamToFile(candidate.url, target, signal, (received, total) => {
    sendProgress(sender, { phase: 'downloading', received, total: total || asset.size, mirror: candidate.label })
  })
  const info = await stat(target)
  if (asset.size > 0 && info.size !== asset.size) {
    throw new Error(`文件大小不符(${info.size}/${asset.size} 字节)`)
  }
  const expected = sums?.get(asset.name)
  if (expected) {
    sendProgress(sender, { phase: 'verifying', received: info.size, total: info.size, mirror: candidate.label })
    const actual = await sha256File(target)
    if (actual !== expected) throw new Error('SHA-256 校验失败,文件可能被篡改')
  }
  sendProgress(sender, { phase: 'done', received: info.size, total: info.size, mirror: candidate.label })
}

export async function downloadUpdate(asset: UpdateAsset, sender: WebContents): Promise<{ path: string }> {
  if (!asset?.name || !asset.url) throw new Error('缺少下载信息,请改用浏览器下载')
  if (activeDownload) throw new Error('已有更新下载在进行中')
  const controller = new AbortController()
  activeDownload = controller
  const dir = updateDir()
  const target = join(dir, asset.name)
  const errors: string[] = []
  try {
    await mkdir(dir, { recursive: true })
    const candidates = buildDownloadCandidates(asset.url, process.env.DSH_UPDATE_MIRRORS)
    // 校验和文件拉一次就够:内容只跟 release 有关,与走哪条镜像无关。
    const sums = await fetchSums(asset.url, controller.signal)
    for (const candidate of candidates) {
      try {
        await tryCandidate(candidate, asset, target, sums, sender, controller.signal)
        return { path: target }
      } catch (error) {
        if (controller.signal.aborted) throw new Error('下载已取消')
        errors.push(`${candidate.label}:${errorMessage(error)}`)
        await rm(target, { force: true })
      }
    }
    throw new Error(`所有下载源都失败了:\n${errors.join('\n')}`)
  } finally {
    activeDownload = null
    if (controller.signal.aborted) await rm(target, { force: true })
  }
}

export function cancelUpdateDownload(): void {
  activeDownload?.abort()
}

/**
 * 安装已下载的更新。win 安装版退出后由 NSIS 向导覆盖安装;便携版退出后由 bat
 * 脚本替换 EXE 并重启;mac 无签名做不到自替换,只打开所在文件夹交给用户。
 */
export async function installUpdate(path: string): Promise<'restarting' | 'revealed'> {
  // 只允许安装本模块下载到更新目录里的文件,渲染端不能借此启动任意程序。
  const dir = resolve(updateDir())
  const target = resolve(path)
  if (!target.startsWith(dir + sep)) throw new Error('非法的更新文件路径')
  if (process.platform === 'darwin') {
    shell.showItemInFolder(target)
    return 'revealed'
  }
  if (process.platform !== 'win32') throw new Error('当前平台不支持应用内安装')
  const portableTarget = process.env.PORTABLE_EXECUTABLE_FILE
  if (portableTarget) {
    const script = join(dir, 'dsh-editor-portable-update.bat')
    await writeFile(script, buildPortableSwapScript(process.pid, portableTarget, target))
    spawn('cmd.exe', ['/c', 'start', '', '/min', script], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
  }
  app.quit()
  return 'restarting'
}
