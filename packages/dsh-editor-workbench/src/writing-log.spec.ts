import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WRITING_LOG_MAX_DAYS, WRITING_LOG_PATH, WritingLogError, readWritingHistory, recordWritingProgress } from './writing-log.ts'
import type { MetadataAccess } from './metadata-io.ts'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-writing-log-'))
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function access(mode = 'workspace-write'): MetadataAccess {
  return { path: root, mode }
}

async function writeLog(text: string): Promise<void> {
  await fs.mkdir(path.join(root, '.dsh-editor'), { recursive: true })
  await fs.writeFile(path.join(root, '.dsh-editor', 'writing-log.json'), text, 'utf8')
}

function at(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 15, 0, 0)
}

describe('writing log', () => {
  it('records today and dedupes by local date', async () => {
    const now = at(2026, 9, 7)
    await expect(recordWritingProgress(access(), 1200, now)).resolves.toEqual({ date: '2026-09-07', chars: 1200, delta: 0 })
    await expect(recordWritingProgress(access(), 1500, now)).resolves.toEqual({ date: '2026-09-07', chars: 1500, delta: 0 })
    const stored = JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'writing-log.json'), 'utf8'))
    expect(stored).toEqual([{ date: '2026-09-07', chars: 1500, delta: 0 }])
    await expect(recordWritingProgress(access(), 1800, at(2026, 9, 8))).resolves.toEqual({ date: '2026-09-08', chars: 1800, delta: 300 })
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'writing-log.json'), 'utf8'))).toEqual([
      { date: '2026-09-07', chars: 1500, delta: 0 },
      { date: '2026-09-08', chars: 1800, delta: 300 },
    ])
  })

  it('caps stored history at 400 days', async () => {
    const start = at(2025, 1, 1)
    const unique = Array.from({ length: WRITING_LOG_MAX_DAYS }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return { date: key, chars: 1000 + index }
    })
    expect(unique[0]?.date).toBe('2025-01-01')
    await writeLog(`${JSON.stringify(unique, null, 2)}\n`)
    const recorded = await recordWritingProgress(access(), 9000, at(2026, 9, 7))
    expect(recorded).toEqual({ date: '2026-09-07', chars: 9000, delta: 9000 - unique.at(-1)!.chars })
    const stored = JSON.parse(await fs.readFile(path.join(root, WRITING_LOG_PATH), 'utf8')) as Array<{ date: string }>
    expect(stored).toHaveLength(WRITING_LOG_MAX_DAYS)
    expect(stored[0]?.date).toBe(unique[1]!.date)
    expect(stored.at(-1)?.date).toBe('2026-09-07')
  })

  it('computes history deltas and weekly sums from the prior recorded day', async () => {
    await recordWritingProgress(access(), 500, at(2026, 8, 1))
    await recordWritingProgress(access(), 800, at(2026, 9, 1))
    await recordWritingProgress(access(), 1100, at(2026, 9, 6))
    await recordWritingProgress(access(), 1250, at(2026, 9, 7))
    await expect(readWritingHistory(access(), 7, at(2026, 9, 7))).resolves.toEqual({
      days: [
        { date: '2026-09-01', chars: 800, delta: 300 },
        { date: '2026-09-06', chars: 1100, delta: 300 },
        { date: '2026-09-07', chars: 1250, delta: 150 },
      ],
      weeks: [
        { weekStart: '2026-08-31', chars: 1100, delta: 600 },
        { weekStart: '2026-09-07', chars: 1250, delta: 150 },
      ],
    })
    await expect(readWritingHistory(access(), 40, at(2026, 9, 7))).resolves.toMatchObject({
      days: [
        { date: '2026-08-01', chars: 500, delta: 0 },
        { date: '2026-09-01', chars: 800, delta: 300 },
        { date: '2026-09-06', chars: 1100, delta: 300 },
        { date: '2026-09-07', chars: 1250, delta: 150 },
      ],
    })
    await expect(readWritingHistory(access(), undefined, at(2026, 9, 7))).resolves.toMatchObject({
      days: [
        { date: '2026-09-01', chars: 800, delta: 300 },
        { date: '2026-09-06', chars: 1100, delta: 300 },
        { date: '2026-09-07', chars: 1250, delta: 150 },
      ],
    })
  })

  it('fail-opens a corrupt log and rejects invalid arguments', async () => {
    await writeLog('{not json')
    await expect(readWritingHistory(access(), 30, at(2026, 9, 7))).resolves.toEqual({ days: [], weeks: [] })
    await expect(recordWritingProgress(access(), 42, at(2026, 9, 7))).resolves.toEqual({ date: '2026-09-07', chars: 42, delta: 0 })
    expect(JSON.parse(await fs.readFile(path.join(root, '.dsh-editor', 'writing-log.json'), 'utf8'))).toEqual([
      { date: '2026-09-07', chars: 42, delta: 0 },
    ])
    await expect(recordWritingProgress(access(), -1, at(2026, 9, 7))).rejects.toMatchObject({ name: 'WritingLogError', code: 'INVALID' })
    await expect(recordWritingProgress(access(), 1.5, at(2026, 9, 7))).rejects.toBeInstanceOf(WritingLogError)
    await expect(readWritingHistory(access(), 0, at(2026, 9, 7))).rejects.toMatchObject({ code: 'INVALID' })
    await expect(recordWritingProgress(access('read-only'), 10, at(2026, 9, 7))).rejects.toMatchObject({ code: 'READ_ONLY' })
  })
})
