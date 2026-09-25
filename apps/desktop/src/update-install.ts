import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildWindowsUpdateScript, type WindowsUpdatePlan } from './windows-update-helper.js'

export interface UpdateHelper {
  directory: string
  commit(): Promise<void>
  cancel(): Promise<void>
  finished: Promise<void>
}

interface HelperStatus { nonce?: string; phase?: string; message?: string }

/** Resolve only after the helper completed its preflight, not on spawn. */
export async function waitForUpdateHelper(
  child: ChildProcess,
  directory: string,
  nonce: string,
  timeoutMs = 120_000,
): Promise<UpdateHelper> {
  let ended = false
  let failure: Error | undefined
  const finished = new Promise<void>((resolve) => {
    child.once('error', (error) => { failure = error; ended = true; resolve() })
    child.once('exit', (code, signal) => {
      failure ??= new Error(`更新助手已退出(${code ?? signal ?? 'unknown'})`)
      ended = true
      resolve()
    })
  })
  const cancel = async () => {
    await writeFile(join(directory, 'cancel'), nonce).catch(() => undefined)
    if (!ended) { try { child.kill() } catch { /* Keep the original startup failure. */ } }
  }
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (ended) throw failure
      let status: HelperStatus | undefined
      try {
        const text = await readFile(join(directory, 'status.json'), 'utf8')
        if (text.length > 16_384) throw new Error('更新助手返回的状态过大')
        status = JSON.parse(text.replace(/^\uFEFF/, '')) as HelperStatus
      } catch (error) {
        if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (status?.nonce === nonce) {
        if (status.phase === 'failed') throw new Error(status.message || '更新助手准备失败')
        if (status.phase === 'ready') {
          if (ended) throw failure
          child.unref()
          return {
            directory, cancel, finished,
            async commit() {
              if (ended) throw failure
              await writeFile(join(directory, 'commit'), nonce, { flag: 'wx' })
              if (ended) throw failure
            },
          }
        }
      }
      await Promise.race([finished, delay(100)])
    }
    throw new Error('更新助手准备超时,应用未退出')
  } catch (error) {
    await cancel()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\n更新日志:${directory}\n安装包已保留,可打开所在文件夹手动安装`)
  }
}

export async function launchWindowsUpdate(
  input: Omit<WindowsUpdatePlan, 'directory' | 'nonce'>,
): Promise<UpdateHelper> {
  const directory = await mkdtemp(join(dirname(input.source), 'install-'))
  const plan = { ...input, directory, nonce: randomUUID() }
  const script = join(directory, 'update-helper.ps1')
  await writeFile(script, buildWindowsUpdateScript(plan), { flag: 'wx' })
  const log = await open(join(directory, 'helper-startup.log'), 'a')
  try {
    // Absolute system executable, no cmd.exe, no interpolated -Command, and no
    // PowerShell profiles. Node quotes the -File argument, including spaces.
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
    })
    return await waitForUpdateHelper(child, directory, plan.nonce)
  } finally {
    await log.close()
  }
}
