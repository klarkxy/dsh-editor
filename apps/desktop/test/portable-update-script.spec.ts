import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPortableSwapScript } from '../src/portable-update-script.js'

const PID = 999999
const TARGET = 'C:\\Users\\me\\Apps\\DSH Editor-0.1.5-win-x64.exe'
const NEW_EXE = 'C:\\Users\\me\\AppData\\Local\\Temp\\dsh-editor-update\\DSH-Editor-0.3.0-win-x64.exe'
const describeWin = process.platform === 'win32' ? describe : describe.skip

function runBat(scriptPath: string, env: NodeJS.ProcessEnv = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', scriptPath], {
      env: { ...process.env, DSH_UPDATE_TEST_SKIP_START: '1', ...env },
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

describe('buildPortableSwapScript', () => {
  const script = buildPortableSwapScript(PID, TARGET, NEW_EXE)

  it('uses CRLF line endings so cmd parses labels correctly', () => {
    expect(script).toContain('\r\n')
    expect(script).not.toMatch(/[^\r]\n/)
  })

  it('waits for the app PID with a deadline before touching the exe', () => {
    expect(script).toContain(`set "PID=${PID}"`)
    expect(script).toContain('tasklist /FI "PID eq %PID%"')
    expect(script).toContain('GEQ %MAX_WAIT%')
    expect(script.indexOf('tasklist')).toBeLessThan(script.indexOf('copy /y "%NEW%" "%STAGED%"'))
  })

  it('stages the new file, keeps a .bak, and does not delete the live target first', () => {
    expect(script).toContain(`set "TARGET=${TARGET}"`)
    expect(script).toContain(`set "NEW=${NEW_EXE}"`)
    expect(script).toContain('copy /y "%NEW%" "%STAGED%"')
    expect(script).toContain('ren "%TARGET%" "%TARGET_NAME%.bak"')
    expect(script).toContain('move /y "%STAGED%" "%TARGET%"')
    expect(script).toContain(':restore')
    const replaceSection = script.slice(0, script.indexOf(':restore'))
    expect(replaceSection).not.toContain('del "%TARGET%"')
    expect(script.indexOf('ren "%TARGET%"')).toBeLessThan(script.indexOf('move /y "%STAGED%" "%TARGET%"'))
  })

  it('restores the backup and can start the old file if replacement fails', () => {
    expect(script).toContain('move /y "%BACKUP%" "%TARGET%"')
    expect(script).toContain(':fail_keep_old')
    expect(script).toContain('if not defined DSH_UPDATE_TEST_SKIP_START start "" "%TARGET%"')
    expect(script).toContain('DSH_UPDATE_TEST_SKIP_START')
  })

  it('deletes itself at the end', () => {
    expect(script).toContain('del "%~f0"')
  })
})

describeWin('portable swap on Windows', () => {
  it('replaces the old file and keeps a backup when the new file is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-portable-ok-'))
    const target = join(dir, 'app.cmd')
    const next = join(dir, 'next.cmd')
    const script = join(dir, 'swap.bat')
    await writeFile(target, '@echo off\r\necho old>ran-old.txt\r\n', 'utf8')
    await writeFile(next, '@echo off\r\necho new>ran-new.txt\r\n', 'utf8')
    await writeFile(script, buildPortableSwapScript(PID, target, next), 'utf8')
    expect(await runBat(script)).toBe(0)
    expect(await readFile(target, 'utf8')).toContain('ran-new.txt')
    expect(await readFile(join(dir, 'app.cmd.bak'), 'utf8')).toContain('ran-old.txt')
  })

  it('keeps the old file when the new file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-portable-missing-'))
    const target = join(dir, 'app.cmd')
    const next = join(dir, 'missing.cmd')
    const script = join(dir, 'swap.bat')
    await writeFile(target, 'old-bytes', 'utf8')
    await writeFile(script, buildPortableSwapScript(PID, target, next), 'utf8')
    await runBat(script)
    expect(await readFile(target, 'utf8')).toBe('old-bytes')
  })

  it('clears a leftover staged directory and still completes the replace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-portable-stage-'))
    const target = join(dir, 'app.cmd')
    const next = join(dir, 'next.cmd')
    const script = join(dir, 'swap.bat')
    await writeFile(target, 'old-bytes', 'utf8')
    await writeFile(next, 'new-bytes', 'utf8')
    await mkdir(join(dir, 'app.cmd.new'))
    await writeFile(script, buildPortableSwapScript(PID, target, next), 'utf8')
    expect(await runBat(script)).toBe(0)
    expect(await readFile(target, 'utf8')).toBe('new-bytes')
    expect(await readFile(join(dir, 'app.cmd.bak'), 'utf8')).toBe('old-bytes')
  })

  it('keeps the old file when the new path is a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-portable-newdir-'))
    const target = join(dir, 'app.cmd')
    const next = join(dir, 'next.cmd')
    const script = join(dir, 'swap.bat')
    await writeFile(target, 'old-bytes', 'utf8')
    await mkdir(next)
    await writeFile(script, buildPortableSwapScript(PID, target, next), 'utf8')
    await runBat(script)
    expect(await readFile(target, 'utf8')).toBe('old-bytes')
  })

  it('restores the old file if the staged replacement disappears after backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-portable-restore-'))
    const target = join(dir, 'app.cmd')
    const next = join(dir, 'next.cmd')
    const staged = join(dir, 'app.cmd.new')
    const backup = join(dir, 'app.cmd.bak')
    const script = join(dir, 'swap.bat')
    await writeFile(target, 'old-bytes', 'utf8')
    await writeFile(next, 'new-bytes', 'utf8')
    await writeFile(script, buildPortableSwapScript(PID, target, next), 'utf8')
    // Poll instead of fs.watch: libuv's Windows watcher aborts the process
    // (fs-event.c !_wcsnicmp) when a watched temp dir is renamed mid-callback.
    const interval = setInterval(() => {
      try {
        if (existsSync(backup) && existsSync(staged)) rmSync(staged, { force: true })
      } catch {
        // the swap script owns the race; a late delete still leaves either backup or target
      }
    }, 50)
    try {
      await runBat(script, { DSH_UPDATE_TEST_PAUSE: '1' })
    } finally {
      clearInterval(interval)
    }
    expect(await readFile(target, 'utf8')).toBe('old-bytes')
  })
})
