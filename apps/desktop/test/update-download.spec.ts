import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { checkLatest } from '../src/update-checker.js'
import { presentUpdateCheck, UpdateOfferStore } from '../src/update-session.js'

const mocks = vi.hoisted(() => ({
  temp: '', quit: vi.fn(), showItemInFolder: vi.fn(), spawn: vi.fn(), rm: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.temp, quit: mocks.quit },
  shell: { showItemInFolder: mocks.showItemInFolder },
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rm: mocks.rm.mockImplementation(actual.rm) }
})
import { cancelUpdateDownload, downloadUpdate, installUpdate } from '../src/update-download.js'

const bytes = Buffer.from('verified latest release payload')
const digest = createHash('sha256').update(bytes).digest('hex')
const name = 'DSH-Editor-Setup-0.3.6-win-x64.exe'
const id = `v0.3.6:${name}`
const url = `https://github.com/klarkxy/dsh-editor/releases/download/v0.3.6/${name}`
const sender = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
let store: UpdateOfferStore
let fetchMock: ReturnType<typeof vi.fn>
let realRm: typeof rm

beforeEach(async () => {
  mocks.temp = await mkdtemp(join(tmpdir(), 'dsh-update-test-'))
  realRm = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm
  mocks.rm.mockReset().mockImplementation(realRm)
  mocks.quit.mockReset()
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  vi.stubEnv('DSH_UPDATE_MIRRORS', '')
  vi.stubEnv('PORTABLE_EXECUTABLE_FILE', '')
  fetchMock = vi.fn(async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }))
  vi.stubGlobal('fetch', fetchMock)
  store = new UpdateOfferStore()
  store.replaceOffer({ id, tag: 'v0.3.6', version: '0.3.6', asset: { name, url, size: bytes.length, digest } })
})

afterEach(async () => {
  cancelUpdateDownload()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await realRm(mocks.temp, { recursive: true, force: true })
})

describe('update download and install lifecycle', () => {
  it('updates 0.3.1 directly to the latest release with its verified installer', async () => {
    const result = await checkLatest('0.3.1', async () => ({ status: 200, json: async () => ({
      tag_name: 'v0.3.6', assets: [{ name, browser_download_url: url, size: bytes.length, digest: `sha256:${digest}` }],
    }) }))
    const offered = await presentUpdateCheck(result, { platform: 'win32', portable: false, store })
    expect(offered.status).toBe('update-available')
    expect(offered.latest?.version).toBe('0.3.6')
    await downloadUpdate(offered.latest!.asset!.id, sender, store)
    expect(await readFile(store.requireDownload(id).path)).toEqual(bytes)
    expect(fetchMock.mock.calls[0][0]).toContain('/v0.3.6/')
  })

  it('never deletes an old locked installer and uses a new path for retries', async () => {
    const root = join(mocks.temp, 'dsh-editor-update')
    await mkdir(root)
    const old = join(root, name)
    await writeFile(old, 'old locked installer')
    mocks.rm.mockImplementation(async (path, options) => {
      if (path === old) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return realRm(path, options)
    })
    await downloadUpdate(id, sender, store)
    const first = store.requireDownload(id).path
    await downloadUpdate(id, sender, store)
    expect(store.requireDownload(id).path).not.toBe(first)
    expect(await readFile(old, 'utf8')).toBe('old locked installer')
    expect(mocks.rm).not.toHaveBeenCalledWith(old, expect.anything())
  })

  it('continues to another source even when a failed partial file cannot be removed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('corrupt'))
    mocks.rm.mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
    await downloadUpdate(id, sender, store)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await readFile(store.requireDownload(id).path)).toEqual(bytes)
  })

  it('keeps integrity failures as the reported error when cleanup is locked', async () => {
    fetchMock.mockImplementation(async () => new Response(Buffer.alloc(bytes.length)))
    mocks.rm.mockRejectedValue(new Error('EBUSY'))
    await expect(downloadUpdate(id, sender, store)).rejects.toThrow('SHA-256')
    expect(store.downloaded).toBeNull()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('cancels a pending response and permits a fresh retry', async () => {
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = downloadUpdate(id, sender, store)
    const rejected = expect(pending).rejects.toThrow('下载已取消')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await expect(downloadUpdate(id, sender, store)).rejects.toThrow('已有更新操作')
    await expect(installUpdate(id, store)).rejects.toThrow('已有更新操作')
    cancelUpdateDownload()
    await rejected
    expect(store.downloaded).toBeNull()
    await downloadUpdate(id, sender, store)
    expect(store.downloaded).not.toBeNull()
  })

  it('falls back when a source stalls before responding', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = downloadUpdate(id, sender, store)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(30_000)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.downloaded).not.toBeNull()
  })

  it('cancels while reading a response body and does not record a partial file', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 5)) },
    })))
    const pending = downloadUpdate(id, sender, store)
    const rejected = expect(pending).rejects.toThrow('下载已取消')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    cancelUpdateDownload()
    await rejected
    expect(store.downloaded).toBeNull()
  })

  it.runIf(process.platform === 'win32')('reports installer launch failure without quitting and permits retry', async () => {
    await downloadUpdate(id, sender, store)
    mocks.spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
      queueMicrotask(() => child.emit('error', new Error('EACCES')))
      return child
    })
    await expect(installUpdate(id, store)).rejects.toThrow('EACCES')
    expect(mocks.quit).not.toHaveBeenCalled()
    await expect(installUpdate(id, store)).resolves.toBe('restarting')
    expect(mocks.spawn).toHaveBeenLastCalledWith(store.requireDownload(id).path,
      [`/D=${dirname(process.execPath)}`], expect.objectContaining({ detached: true, windowsHide: true, windowsVerbatimArguments: true }))
    expect(mocks.quit).toHaveBeenCalledOnce()
  })

  it.runIf(process.platform === 'win32')('passes NSIS a raw final /D argument even when the current path contains spaces', async () => {
    const originalExecPath = process.execPath
    const installDir = join(mocks.temp, 'Program Files', 'DSH Editor')
    const probe = join(mocks.temp, 'raw command line.ps1')
    await writeFile(probe, '[Environment]::CommandLine')
    const { spawn: realSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    let rawCommandLine: Promise<string> | undefined
    mocks.spawn.mockImplementation((_command, args, options) => {
      // Observe Windows' actual command line without starting an installer.
      // Keep the PowerShell probe attached so it can report via stdout.
      const child = realSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `"${probe}"`, ...args], {
        ...options, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
      })
      rawCommandLine = new Promise((resolve, reject) => {
        let output = ''
        let errors = ''
        child.stdout!.on('data', chunk => { output += chunk })
        child.stderr!.on('data', chunk => { errors += chunk })
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)))
      })
      return child
    })
    try {
      process.execPath = join(installDir, 'DSH Editor.exe')
      await downloadUpdate(id, sender, store)
      await installUpdate(id, store)
      const commandLine = await rawCommandLine!
      expect(commandLine).toContain(` /D=${installDir}`)
      expect(commandLine).not.toContain('"/D=')
      expect(commandLine.endsWith(`/D=${installDir}`)).toBe(true)
    } finally {
      process.execPath = originalExecPath
    }
  })

  it('re-verifies the downloaded bytes before any installer is launched', async () => {
    await downloadUpdate(id, sender, store)
    await writeFile(store.requireDownload(id).path, Buffer.alloc(bytes.length))
    await expect(installUpdate(id, store)).rejects.toThrow('SHA-256')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })
})
