import { spawn as nodeSpawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDshWebUrl } from './dsh-url.js'
import type { ChildLike, SpawnChild } from './contracts.js'
import { createNativeInstallAnchor, type CreateNativeInstallAnchor, type NativeInstallAnchor } from './native-install-anchor.js'
import { resolveBundledPackageManager, type BundledPackageManager } from './package-manager.js'

export { createNativeInstallAnchor } from './native-install-anchor.js'
export type { CreateNativeInstallAnchor, NativeInstallAnchor } from './native-install-anchor.js'

export const DSH_NATIVE_ARGS = ['--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'] as const

export interface DshLaunch {
  nodePath: string
  cliPath: string
  home: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
}

/** Compact ESM bootstrap: load the app profile through a TEMP installAnchor, then runCli. */
export function dshCliBootstrap(cliPath: string, packageManager: BundledPackageManager, installAnchor: string, home: string): string {
  const invocation = {
    command: packageManager.command,
    args: [...packageManager.args],
    env: { ...packageManager.env },
  }
  const bootHref = pathToFileURL(join(dirname(dirname(cliPath)), 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')).href
  return `const { runCli } = await import(${JSON.stringify(pathToFileURL(cliPath).href)});
const { loadProfileDirectory } = await import(${JSON.stringify(bootHref)});
process.argv = [process.execPath, ${JSON.stringify(cliPath)}, ...${JSON.stringify([...DSH_NATIVE_ARGS])}];
const profile = loadProfileDirectory('dsh', ${JSON.stringify(join(home, 'profiles', 'dsh-editor'))}, ${JSON.stringify(installAnchor)});
await runCli({ packageManager: ${JSON.stringify(invocation)}, resolvedProfile: { profile, installAnchor: ${JSON.stringify(installAnchor)} } });`
}

function launchEnvironment(launch: DshLaunch): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...launch.env, DSH_HOME: launch.home }
  delete env.npm_execpath
  delete env.npm_config_user_agent
  return env
}
export interface DshSupervisorOptions {
  spawn?: SpawnChild
  forceKillTree?: (pid: number) => Promise<void>
  gracefulStopMs?: number
  onUnexpectedExit?: (reason: Error) => void
  createInstallAnchor?: CreateNativeInstallAnchor
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
  private starting = false
  private anchor: NativeInstallAnchor | undefined
  private readonly spawn: SpawnChild
  private readonly forceKillTree: (pid: number) => Promise<void>
  private readonly gracefulStopMs: number
  private readonly onUnexpectedExit?: (reason: Error) => void
  private readonly createInstallAnchor: CreateNativeInstallAnchor

  constructor(options: DshSupervisorOptions = {}) {
    this.spawn = options.spawn ?? defaultSpawn
    this.forceKillTree = options.forceKillTree ?? defaultForceKillTree
    this.gracefulStopMs = options.gracefulStopMs ?? GRACEFUL_STOP_MS
    this.onUnexpectedExit = options.onUnexpectedExit
    this.createInstallAnchor = options.createInstallAnchor ?? createNativeInstallAnchor
  }

  private async releaseAnchor(): Promise<void> {
    const anchor = this.anchor
    this.anchor = undefined
    if (!anchor) return
    try { await anchor.dispose() } catch { /* TEMP dir may already be gone */ }
  }

  async start(launch: DshLaunch): Promise<URL> {
    if (this.child || this.starting) throw new Error('DSH is already running')
    this.starting = true
    this.stopping = false
    try {
      for (let attempt = 0; ; attempt += 1) {
        const url = await this.launchOnce(launch)
        if (!CHROMIUM_RESTRICTED_PORTS.has(Number(url.port))) return url
        await this.halt()
        if (this.stopping) throw new Error('DSH stopped')
        if (attempt + 1 >= MAX_PORT_RETRIES) {
          throw new Error(`DSH kept landing on Chromium-restricted ports (last: ${url.port})`)
        }
      }
    } finally {
      this.starting = false
    }
  }

  private async launchOnce(launch: DshLaunch): Promise<URL> {
    await this.releaseAnchor()
    const packageManager = resolveBundledPackageManager(launch.nodePath, launch.env)
    try {
      const created = await this.createInstallAnchor(launch.cliPath)
      this.anchor = created
      if (this.stopping) throw new Error('DSH stopped')
      const child = this.spawn(launch.nodePath, ['--input-type=module', '--eval', dshCliBootstrap(launch.cliPath, packageManager, created.installAnchor, launch.home)], {
        env: launchEnvironment(launch), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
      this.child = child
      child.on('exit', (code, signal) => {
        if (this.child !== child) return
        this.child = undefined
        if (this.stopping) return
        void this.releaseAnchor()
        this.onUnexpectedExit?.(new Error(`DSH exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'})`))
      })
      if (this.stopping) throw new Error('DSH stopped')
      const readiness = new Promise<URL>((resolve, reject) => {
        let settled = false
        const traces: string[] = []
        const timeoutMs = launch.timeoutMs ?? READY_TIMEOUT_MS
        const settle = (callback: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          callback()
        }
        const succeed = (url: URL) => settle(() => resolve(url))
        const fail = (error: Error) => settle(() => {
          const detail = traces.length ? `\n${traces.join('\n')}` : ''
          reject(detail ? new Error(`${error.message}${detail}`) : error)
        })
        const timer = setTimeout(() => fail(new Error(`Timed out waiting ${timeoutMs}ms for DSH loopback readiness`)), timeoutMs)
        const inspect = (line: string) => {
          traces.push(line)
          if (traces.length > 80) traces.splice(0, traces.length - 80)
          const url = parseDshWebUrl(line)
          if (url) succeed(url)
        }
        if (child.stdout) consumeLines(child.stdout, inspect)
        if (child.stderr) consumeLines(child.stderr, inspect)
        child.once('error', fail)
        child.once('exit', (code, signal) => fail(new Error(`DSH exited before readiness (code ${code ?? 'none'}, signal ${signal ?? 'none'})`)))
      })
      return await readiness
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.halt()
  }

  private async halt(): Promise<void> {
    const child = this.child
    this.child = undefined
    try {
      if (!child || child.exitCode !== null) return
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      const waitExitOrTimeout = (ms: number) => Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ])
      child.kill('SIGTERM')
      if (await waitExitOrTimeout(this.gracefulStopMs)) return
      if (!child.pid) {
        await waitExitOrTimeout(1_000)
        return
      }
      /* taskkill 可能挂住;子进程在强杀期间(或检查间隙)退出时直接收工,不再白等剩余超时。 */
      await Promise.race([
        this.forceKillTree(child.pid),
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      await waitExitOrTimeout(1_000)
    } finally {
      await this.releaseAnchor()
    }
  }
}
