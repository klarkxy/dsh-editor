// Real Windows PowerShell + real process/file operations. No UAC prompts, network,
// installed application or author data are touched by these disposable fixtures.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import ts from 'typescript'
import { afterEach, describe, it } from 'vitest'
import { launchWindowsUpdate } from '../src/update-install.js'

const windows = process.platform === 'win32' ? describe : describe.skip
const processes: ChildProcess[] = []
const directories: string[] = []
const originalReport = process.env.DSH_UPDATE_TEST_REPORT
const originalPortable = process.env.PORTABLE_EXECUTABLE_FILE
const originalElectron = process.env.ELECTRON_RUN_AS_NODE
let compiled: Buffer | undefined

async function runPowerShell(script: string): Promise<void> {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  child.stderr?.on('data', (chunk) => { errors += String(chunk) })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, errors)
}
async function executable(dir: string): Promise<Buffer> {
  if (compiled) return compiled
  const output = join(dir, 'fixture.exe')
  const encodedPath = Buffer.from(output).toString('base64')
  await runPowerShell(`$ErrorActionPreference='Stop'
$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
Add-Type -OutputAssembly $path -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class UpdateFixture {
  public static int Main(string[] args) {
    var directory = Environment.GetEnvironmentVariable("DSH_UPDATE_TEST_REPORT");
    if (directory != null) {
      File.WriteAllText(Path.Combine(directory, "commandline.txt"), Environment.CommandLine);
      File.WriteAllText(Path.Combine(directory, "environment.txt"),
        (Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_FILE") ?? "<unset>") + "\\n" +
        (Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE") ?? "<unset>"));
    }
    return 0;
  }
}
'@`)
  compiled = await readFile(output)
  return compiled
}
async function fixture(valid = true) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-update-win-'))
  directories.push(dir)
  const targetDir = join(dir, '中文 & %PATH% ! (应用)')
  const downloadDir = join(dir, '下载 & %TEMP% ! (更新)')
  await mkdir(targetDir)
  await mkdir(downloadDir)
  const source = join(downloadDir, 'DSH Editor.exe'), target = join(targetDir, 'DSH Editor.exe')
  const bytes = valid ? await executable(dir) : Buffer.from('this is not an executable')
  await writeFile(source, bytes)
  await writeFile(target, 'old application bytes')
  process.env.DSH_UPDATE_TEST_REPORT = dir
  process.env.PORTABLE_EXECUTABLE_FILE = 'must-not-be-inherited'
  process.env.ELECTRON_RUN_AS_NODE = '1'
  const parent = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true })
  processes.push(parent)
  await once(parent, 'spawn')
  return { dir, source, target, targetDir, parent, bytes,
    size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex'), parentPid: parent.pid!, interactive: false }
}
function plan(f: Awaited<ReturnType<typeof fixture>>) {
  return { source: f.source, target: f.target, size: f.size, digest: f.digest, parentPid: f.parentPid, interactive: false }
}
async function stop(parent: ChildProcess) {
  if (parent.exitCode !== null || parent.signalCode !== null) return
  const exited = once(parent, 'exit')
  parent.kill()
  await exited
}
async function status(dir: string) {
  const deadline = Date.now() + 2_000
  for (;;) {
    try {
      return JSON.parse((await readFile(join(dir, 'status.json'), 'utf8')).replace(/^\uFEFF/, '')) as { phase: string; backup: string; message: string }
    } catch (error) {
      // Windows can report ENOENT while ReplaceFile publishes the next snapshot.
      if (Date.now() >= deadline || (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')) throw error
      await delay(25)
    }
  }
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  for (const [key, value] of [['DSH_UPDATE_TEST_REPORT', originalReport], ['PORTABLE_EXECUTABLE_FILE', originalPortable], ['ELECTRON_RUN_AS_NODE', originalElectron]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

windows('Windows update transactions', () => {
  it('finishes the update after the process that launched the helper exits', async () => {
    const f = await fixture()
    await stop(f.parent)
    for (const name of ['update-install', 'windows-update-helper']) {
      const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
      const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      await writeFile(join(f.dir, `${name}.js`), output)
    }
    await writeFile(join(f.dir, 'package.json'), '{"type":"module"}')
    const moduleUrl = pathToFileURL(join(f.dir, 'update-install.js')).href
    const input = { ...plan(f), mode: 'portable', waitMs: 10_000 }
    const script = `import { launchWindowsUpdate } from ${JSON.stringify(moduleUrl)};
      const helper = await launchWindowsUpdate({ ...${JSON.stringify(input)}, parentPid: process.pid });
      await helper.commit();
      process.exit(0);`
    const launcher = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    processes.push(launcher)
    let errors = ''
    launcher.stderr?.on('data', (chunk) => { errors += String(chunk) })
    const [code] = await once(launcher, 'exit')
    assert.equal(code, 0, errors)
    const helperName = (await readdir(join(f.source, '..'))).find((name) => name.startsWith('install-'))!
    assert.ok(helperName)
    const helperDir = join(f.source, '..', helperName)
    const deadline = Date.now() + 15_000
    let result = await status(helperDir)
    while (!['launched', 'failed'].includes(result.phase) && Date.now() < deadline) {
      await delay(100)
      result = await status(helperDir)
    }
    assert.equal(result.phase, 'launched', result.message)
    assert.deepEqual(await readFile(f.target), f.bytes)
    assert.equal(await readFile(result.backup, 'utf8'), 'old application bytes')
  }, 30_000)

  it('replaces the portable app after exit, keeps a backup and clears launcher-only environment', async () => {
    const f = await fixture()
    const helper = await launchWindowsUpdate({ ...plan(f), mode: 'portable', waitMs: 10_000 })
    assert.equal(await readFile(f.target, 'utf8'), 'old application bytes')
    await helper.commit()
    await stop(f.parent)
    await helper.finished
    const result = await status(helper.directory)
    assert.equal(result.phase, 'launched', result.message)
    assert.deepEqual(await readFile(f.target), f.bytes)
    assert.equal(await readFile(result.backup, 'utf8'), 'old application bytes')
    assert.deepEqual(await readFile(f.source), f.bytes)
    assert.equal(await readFile(join(f.dir, 'environment.txt'), 'utf8'), '<unset>\n<unset>')
  }, 30_000)
  it('never deletes pre-existing .new/.bak files or directories', async () => {
    const f = await fixture()
    await mkdir(f.target + '.new')
    await writeFile(join(f.target + '.new', 'author-data.txt'), 'keep me')
    await writeFile(f.target + '.bak', 'older backup')
    const helper = await launchWindowsUpdate({ ...plan(f), mode: 'portable' })
    await helper.commit()
    await stop(f.parent)
    await helper.finished
    assert.equal((await status(helper.directory)).phase, 'launched')
    assert.equal(await readFile(join(f.target + '.new', 'author-data.txt'), 'utf8'), 'keep me')
    assert.equal(await readFile(f.target + '.bak', 'utf8'), 'older backup')
  }, 30_000)
  it('restores the old portable app when the replacement cannot be started', async () => {
    const f = await fixture(false)
    const helper = await launchWindowsUpdate({ ...plan(f), mode: 'portable' })
    await helper.commit()
    await stop(f.parent)
    await helper.finished
    assert.equal((await status(helper.directory)).phase, 'failed')
    assert.equal(await readFile(f.target, 'utf8'), 'old application bytes')
    assert.deepEqual(await readFile(f.source), f.bytes)
  }, 30_000)
  it('leaves the old app in place when staged bytes change after readiness', async () => {
    const f = await fixture()
    const helper = await launchWindowsUpdate({ ...plan(f), mode: 'portable' })
    const staged = (await readdir(f.targetDir)).find((name) => name.startsWith('.dsh-update-'))!
    assert.ok(staged)
    await writeFile(join(f.targetDir, staged), 'tampered')
    await helper.commit()
    await stop(f.parent)
    await helper.finished
    assert.equal((await status(helper.directory)).phase, 'failed')
    assert.equal(await readFile(f.target, 'utf8'), 'old application bytes')
  }, 30_000)
  it('does not replace a running app when quitting is delayed or vetoed', async () => {
    const f = await fixture()
    const helper = await launchWindowsUpdate({ ...plan(f), mode: 'portable', waitMs: 500 })
    await helper.commit()
    await helper.finished
    assert.equal((await status(helper.directory)).phase, 'failed')
    assert.equal(f.parent.exitCode, null)
    assert.equal(await readFile(f.target, 'utf8'), 'old application bytes')
  }, 30_000)
  it('rejects a missing download and a directory before authorizing quit', async () => {
    const f = await fixture()
    await rm(f.source)
    await assert.rejects(launchWindowsUpdate({ ...plan(f), mode: 'portable' }))
    await mkdir(f.source)
    await assert.rejects(launchWindowsUpdate({ ...plan(f), mode: 'portable' }))
    assert.equal(f.parent.exitCode, null)
    assert.equal(await readFile(f.target, 'utf8'), 'old application bytes')
  }, 30_000)
  it('passes the installed app directory as the raw final NSIS /D argument', async () => {
    const f = await fixture()
    const helper = await launchWindowsUpdate({ ...plan(f), mode: 'setup' })
    await helper.commit()
    await stop(f.parent)
    await helper.finished
    const result = await status(helper.directory)
    assert.equal(result.phase, 'completed', result.message)
    const command = await readFile(join(f.dir, 'commandline.txt'), 'utf8')
    assert.ok(command.endsWith(` /D=${f.targetDir}`), command)
    assert.equal(command.includes('"/D='), false)
  }, 30_000)
})
