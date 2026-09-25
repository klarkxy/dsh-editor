import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, open, readFile, rename, writeFile } from 'node:fs/promises'
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
              const pending = join(directory, 'commit.tmp')
              await writeFile(pending, nonce, { flag: 'wx' })
              await rename(pending, join(directory, 'commit'))
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
    // Absolute system executable and no PowerShell profiles. Paths travel as
    // encoded JSON data; the worker script path is quoted for -File.
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // Start-Process gives Windows PowerShell its own hidden console. libuv's
    // DETACHED_PROCESS can make PowerShell exit without executing; sharing the
    // launcher's console can instead terminate it when the application exits.
    // The bootstrap waits while the app is alive; the worker owns the transaction.
    const payload = Buffer.from(JSON.stringify({ executable, script, log: join(directory, 'helper-worker.log') }), 'utf8').toString('base64')
    const bootstrap = `$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $p.script + '"'
$worker=Start-Process -FilePath $p.executable -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $p.log -RedirectStandardError ($p.log + '.err')
$worker.WaitForExit()
exit $worker.ExitCode`
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], {
      windowsHide: true, stdio: ['ignore', log.fd, log.fd],
    })
    return await waitForUpdateHelper(child, directory, plan.nonce)
  } finally {
    await log.close()
  }
}
