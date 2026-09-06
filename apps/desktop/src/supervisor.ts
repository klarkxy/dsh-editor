import { spawn as nodeSpawn } from 'node:child_process'
import { once } from 'node:events'
import { parseDshWebUrl } from './dsh-url.js'
import type { ChildLike, SpawnChild } from './contracts.js'

export interface DshLaunch {
  nodePath: string
  cliPath: string
  home: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
}
export interface DshSupervisorOptions {
  spawn?: SpawnChild
  forceKillTree?: (pid: number) => Promise<void>
  gracefulStopMs?: number
  onUnexpectedExit?: (reason: Error) => void
}
const READY_TIMEOUT_MS = 20_000
const GRACEFUL_STOP_MS = 5_000
const MAX_PORT_RETRIES = 5
// Chromium 的 unsafe 端口清单:随机端口撞上时窗口以 ERR_UNSAFE_PORT 拒绝加载,
// 只能杀掉服务重新随机一个。
const CHROMIUM_RESTRICTED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 523, 540, 548, 554, 556,
  563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
])

function defaultSpawn(command: string, args: string[], options: Parameters<SpawnChild>[2]): ChildLike {
  return nodeSpawn(command, args, options) as ChildLike
}
async function defaultForceKillTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') return
  const killer = nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  await once(killer, 'exit')
}
function consumeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffered = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffered += chunk
    let index: number
    while ((index = buffered.indexOf('\n')) >= 0) {
      onLine(buffered.slice(0, index).replace(/\r$/u, ''))
      buffered = buffered.slice(index + 1)
    }
  })
}

export class DshSupervisor {
  private child: ChildLike | undefined
  private stopping = false
  private readonly spawn: SpawnChild
  private readonly forceKillTree: (pid: number) => Promise<void>
  private readonly gracefulStopMs: number
  private readonly onUnexpectedExit?: (reason: Error) => void

  constructor(options: DshSupervisorOptions = {}) {
    this.spawn = options.spawn ?? defaultSpawn
    this.forceKillTree = options.forceKillTree ?? defaultForceKillTree
    this.gracefulStopMs = options.gracefulStopMs ?? GRACEFUL_STOP_MS
    this.onUnexpectedExit = options.onUnexpectedExit
  }

  async start(launch: DshLaunch): Promise<URL> {
    if (this.child) throw new Error('DSH is already running')
    for (let attempt = 0; ; attempt += 1) {
      const url = await this.launchOnce(launch)
      if (!CHROMIUM_RESTRICTED_PORTS.has(Number(url.port))) return url
      await this.stop()
      if (attempt + 1 >= MAX_PORT_RETRIES) {
        throw new Error(`DSH kept landing on Chromium-restricted ports (last: ${url.port})`)
      }
    }
  }

  private async launchOnce(launch: DshLaunch): Promise<URL> {
    this.stopping = false
    const child = this.spawn(launch.nodePath, [launch.cliPath, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      env: { ...launch.env, DSH_HOME: launch.home }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    this.child = child
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      if (!this.stopping) this.onUnexpectedExit?.(new Error(`DSH exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'})`))
    })
    const readiness = new Promise<URL>((resolve, reject) => {
      let settled = false
      const timeoutMs = launch.timeoutMs ?? READY_TIMEOUT_MS
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      const succeed = (url: URL) => settle(() => resolve(url))
      const fail = (error: Error) => settle(() => reject(error))
      const timer = setTimeout(() => fail(new Error(`Timed out waiting ${timeoutMs}ms for DSH loopback readiness`)), timeoutMs)
      const inspect = (line: string) => {
        const url = parseDshWebUrl(line)
        if (url) succeed(url)
      }
      if (child.stdout) consumeLines(child.stdout, inspect)
      if (child.stderr) consumeLines(child.stderr, inspect)
      child.once('error', fail)
      child.once('exit', (code, signal) => fail(new Error(`DSH exited before readiness (code ${code ?? 'none'}, signal ${signal ?? 'none'})`)))
    })
    try {
      return await readiness
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) return
    this.stopping = true
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    const graceful = await Promise.race([exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), this.gracefulStopMs))])
    if (!graceful && child.pid) {
      await Promise.race([
        this.forceKillTree(child.pid),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))])
    }
  }
}
