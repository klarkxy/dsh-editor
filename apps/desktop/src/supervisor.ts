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
