import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CRASH_REPORTS_RETAINED,
  ERROR_SECTION_MAX_CHARS,
  RENDERER_CONSOLE_MAX_BYTES,
  RendererConsoleTail,
  crashReportFileName,
  pruneCrashReports,
  writeCrashReport,
  type CrashReportFacts,
} from '../src/crash-report.js'

const facts: CrashReportFacts = {
  name: 'DSH Editor',
  version: '0.4.3',
  platform: 'win32',
  arch: 'x64',
  electron: '37.2.6',
  node: 'v24.16.0',
  locale: 'zh-CN',
}

describe('renderer console tail', () => {
  it('keeps the newest lines within the byte cap, dropping from the head', () => {
    const tail = new RendererConsoleTail(100)
    for (let index = 0; index < 20; index += 1) tail.append(`line-${String(index).padStart(2, '0')} ${'x'.repeat(20)}`)
    const kept = tail.snapshot()
    expect(kept[0]).not.toBe('line-00 xxxxxxxxxxxxxxxxxxxx')
    expect(kept.at(-1)).toContain('line-19')
    expect(kept.reduce((total, line) => total + Buffer.byteLength(line), 0)).toBeLessThanOrEqual(100)
  })
  it('keeps one oversized line whole so a long stack is never cut mid-line', () => {
    const tail = new RendererConsoleTail(16)
    tail.append('short')
    tail.append('y'.repeat(RENDERER_CONSOLE_MAX_BYTES))
    expect(tail.snapshot()).toEqual(['y'.repeat(RENDERER_CONSOLE_MAX_BYTES)])
  })
})

describe('crash report files', () => {
  it('writes header facts, the inspected error, and the console tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-crash-'))
    const path = await writeCrashReport(dir, {
      source: 'supervisor',
      error: new Error('DSH exited unexpectedly (code 23, signal none)'),
      rendererConsole: ['Uncaught TypeError: boom'],
    }, facts, new Date('2026-02-03T04:05:06.789Z'))
    expect(path).toBe(join(dir, 'crash-2026-02-03T04-05-06-789Z-supervisor.log'))
    const content = await readFile(path!, 'utf8')
    expect(content).toContain('source: supervisor')
    expect(content).toContain('app: DSH Editor 0.4.3')
    expect(content).toContain('electron: 37.2.6')
    expect(content).toContain('locale: zh-CN')
    expect(content).toContain('DSH exited unexpectedly (code 23, signal none)')
    expect(content).toContain('Uncaught TypeError: boom')
    expect(content).toContain('pid: ')
  })
  it.runIf(process.platform !== 'win32')('writes the report 0600 inside a 0700 directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-crash-'))
    const dir = join(parent, 'logs')
    const path = await writeCrashReport(dir, { source: 'main', error: new Error('boom') }, facts)
    expect((await stat(path!)).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })
  it('never overwrites an existing report and never throws on write failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-crash-'))
    const time = new Date('2026-02-03T04:05:06.789Z')
    const first = await writeCrashReport(dir, { source: 'renderer', error: new Error('first') }, facts, time)
    const second = await writeCrashReport(dir, { source: 'renderer', error: new Error('second') }, facts, time)
    expect(second).toBeUndefined()
    expect(await readFile(first!, 'utf8')).toContain('first')
    expect(await readFile(first!, 'utf8')).not.toContain('second')
  })
  it('caps the inspected error section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-crash-'))
    /* inspect 的 maxStringLength 只截单条字符串;用多条短串堆出超限的总渲染量。 */
    const dump = Array.from({ length: 100 }, (_, index) => `chunk-${index}: ${'z'.repeat(3_000)}`)
    const path = await writeCrashReport(dir, {
      source: 'main',
      error: Object.assign(new Error('huge'), { dump }),
    }, facts)
    const content = await readFile(path!, 'utf8')
    expect(content.length).toBeLessThan(ERROR_SECTION_MAX_CHARS + 4096)
    expect(content).toContain('error section cut at')
  })
  it('prunes only crash-* reports by name order and keeps the newest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-crash-'))
    for (let index = 0; index < CRASH_REPORTS_RETAINED + 2; index += 1) {
      const name = crashReportFileName(new Date(Date.UTC(2026, 1, 1, 0, 0, index)), 'main')
      await writeFile(join(dir, name), `report ${index}`)
    }
    await writeFile(join(dir, 'notes.txt'), 'keep')
    await writeFile(join(dir, 'crash-notes.txt'), 'keep')
    await writeFile(join(dir, 'crash-2026-02-01T00-00-supervisor.log'), 'malformed name, keep')
    await pruneCrashReports(dir)
    const remaining = (await readdir(dir)).sort()
    const reports = remaining.filter((name) => /^crash-.*-main\.log$/u.test(name))
    expect(reports).toHaveLength(CRASH_REPORTS_RETAINED)
    expect(reports.at(0)).toBe('crash-2026-02-01T00-00-02-000Z-main.log')
    expect(reports.at(-1)).toBe('crash-2026-02-01T00-00-11-000Z-main.log')
    expect(remaining).not.toContain('crash-2026-02-01T00-00-00-000Z-main.log')
    expect(remaining).not.toContain('crash-2026-02-01T00-00-01-000Z-main.log')
    expect(remaining).toContain('notes.txt')
    expect(remaining).toContain('crash-notes.txt')
    expect(remaining).toContain('crash-2026-02-01T00-00-supervisor.log')
  })
  it('treats a missing directory as nothing to prune', async () => {
    await pruneCrashReports(join(tmpdir(), 'dsh-crash-does-not-exist'))
  })
})
