import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { waitForUpdateHelper } from '../src/update-install.js'
import { buildWindowsUpdateScript } from '../src/windows-update-helper.js'

const directories: string[] = []
const nonce = '12345678-test-12345678'
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'dsh-handshake-'))
  directories.push(path)
  return path
}
function child() {
  let unreferenced = false, killed = false
  const events = Object.assign(new EventEmitter(), {
    unref() { unreferenced = true }, kill() { killed = true; events.emit('exit', 1); return true },
  })
  return { process: events as unknown as ChildProcess, events, unreferenced: () => unreferenced, killed: () => killed }
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Windows updater readiness protocol', () => {
  it('does not treat spawn as readiness and cancels a stalled helper', async () => {
    const dir = await directory(), process = child()
    const pending = waitForUpdateHelper(process.process, dir, nonce, 30)
    process.events.emit('spawn')
    await assert.rejects(pending, /准备超时/)
    assert.equal(process.unreferenced(), false)
    assert.equal(process.killed(), true)
    assert.equal(await readFile(join(dir, 'cancel'), 'utf8'), nonce)
  })
  it('rejects a helper that exits immediately after spawn, retaining diagnostics', async () => {
    const dir = await directory(), process = child()
    const pending = waitForUpdateHelper(process.process, dir, nonce)
    process.events.emit('spawn')
    process.events.emit('exit', 1)
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message.includes(dir) && error.message.includes('已退出'))
  })
  it('reports process creation failures without authorizing an application quit', async () => {
    const dir = await directory(), process = child()
    const pending = waitForUpdateHelper(process.process, dir, nonce)
    process.events.emit('error', new Error('EACCES'))
    await assert.rejects(pending, /EACCES/)
    assert.equal(process.unreferenced(), false)
  })
  it('ignores an old or mismatched transaction status', async () => {
    const dir = await directory(), process = child()
    await writeFile(join(dir, 'status.json'), JSON.stringify({ nonce: 'old-nonce', phase: 'ready' }))
    await assert.rejects(waitForUpdateHelper(process.process, dir, nonce, 30), /准备超时/)
    assert.equal(process.unreferenced(), false)
  })
  it('propagates a preflight failure even when the helper process is alive', async () => {
    const dir = await directory(), process = child()
    await writeFile(join(dir, 'status.json'), JSON.stringify({ nonce, phase: 'failed', message: 'disk is full' }))
    await assert.rejects(waitForUpdateHelper(process.process, dir, nonce), /disk is full/)
    assert.equal(process.killed(), true)
  })
  it('requires an explicit commit after readiness and settles after process exit', async () => {
    const dir = await directory(), process = child()
    await writeFile(join(dir, 'status.json'), '\uFEFF' + JSON.stringify({ nonce, phase: 'ready' }))
    const helper = await waitForUpdateHelper(process.process, dir, nonce)
    await assert.rejects(readFile(join(dir, 'commit')), /ENOENT/)
    await helper.commit()
    assert.equal(await readFile(join(dir, 'commit'), 'utf8'), nonce)
    assert.equal(process.unreferenced(), true)
    process.events.emit('exit', 0)
    await helper.finished
    await assert.rejects(helper.commit(), /已退出/)
  })
})

describe('Windows helper command construction', () => {
  const plan = { mode: 'portable' as const, parentPid: 1234, size: 10, digest: 'a'.repeat(64), nonce,
    source: 'C:\\测试 & ! %PATH% (包)\\新版.exe', target: 'C:\\我的文件\\旧版.exe', directory: 'C:\\临时文件\\install-abc' }
  it('transports paths as UTF-8 JSON data, never interpolated shell source', () => {
    const script = buildWindowsUpdateScript(plan)
    assert.equal(script.charCodeAt(0), 0xfeff)
    const encoded = /FromBase64String\('([^']+)'\)/.exec(script)?.[1]
    assert.ok(encoded)
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    assert.equal(decoded.source, plan.source)
    assert.equal(decoded.target, plan.target)
    assert.equal(script.includes(plan.source), false)
    assert.equal(script.includes('cmd.exe /c'), false)
  })
  it('validates process identity, transaction token, size and digest', () => {
    for (const patch of [{ parentPid: 0 }, { size: -1 }, { digest: 'g'.repeat(64) }, { nonce: 'bad\nnonce' }, { source: 'C:\\bad\npath' }]) {
      assert.throws(() => buildWindowsUpdateScript({ ...plan, ...patch }))
    }
  })
  it('stages before readiness, commits before waiting for exit, and retains a unique backup', () => {
    const script = buildWindowsUpdateScript(plan)
    assert.ok(script.indexOf('$inputFile.CopyTo') < script.indexOf("State 'ready'"))
    assert.ok(script.indexOf('Invalid update commit token') < script.indexOf('$parent.WaitForExit'))
    assert.ok(script.indexOf('[IO.File]::Move($plan.target, $backup)') < script.indexOf('[IO.File]::Move($stage, $plan.target)'))
    assert.match(script, /\.bak-.*plan.nonce/)
    assert.match(script, /Old version restored/)
    assert.doesNotMatch(script, /rd \/s|Remove-Item.*-Recurse|Directory\]::Delete/)
  })
})
