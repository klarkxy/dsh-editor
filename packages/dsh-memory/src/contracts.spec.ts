import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { CHAT_EVENTS_SLOT, MEMORY_ACTIVATE_ID, MEMORY_PLUGIN, projectIdFromCwd } from './contracts.ts'
import { CHAT_EVENTS_SLOT as FROZEN_SLOT, projectIdFromCwd as frozenProjectIdFromCwd } from '@klarkxy/dsh-ai-services/contracts'

it('reexports frozen chat seat and untruncated project identity', () => {
  const frozen = readFileSync(fileURLToPath(new URL('../../dsh-ai-services/src/contracts.ts', import.meta.url)), 'utf8')
  expect(CHAT_EVENTS_SLOT).toBe(FROZEN_SLOT)
  expect(CHAT_EVENTS_SLOT).toBe('dsh-editor.chat.events')
  expect(frozen).toContain('basis?: Array<{ id: string; revision: number }>')
  expect(projectIdFromCwd).toBe(frozenProjectIdFromCwd)
  expect(MEMORY_ACTIVATE_ID).toBe(MEMORY_PLUGIN)
  expect(MEMORY_ACTIVATE_ID).toBe('@klarkxy/dsh-memory')
})

it('keeps the full slash-normalized project path without 256-char truncation', () => {
  expect(projectIdFromCwd(undefined)).toBeUndefined()
  expect(projectIdFromCwd('  ')).toBeUndefined()
  expect(projectIdFromCwd('D:\\work\\Novel\\')).toBe('D:/work/Novel')
  expect(projectIdFromCwd('/')).toBe('/')
  expect(projectIdFromCwd('C:\\')).toBe('C:/')
  const left = `/${'a'.repeat(200)}/one`
  const right = `/${'a'.repeat(200)}/two`
  expect(left.length).toBeGreaterThan(200)
  expect(projectIdFromCwd(left)).toBe(left)
  expect(projectIdFromCwd(right)).toBe(right)
  expect(projectIdFromCwd(left)).not.toBe(projectIdFromCwd(right))
})
