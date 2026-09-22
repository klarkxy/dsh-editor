import { CHAT_EVENTS_SLOT as FROZEN_SLOT, projectIdFromCwd as frozenProjectId } from '@klarkxy/dsh-ai-services/contracts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { CHAT_EVENTS_SLOT, projectIdFromCwd, SELF_IMPROVEMENT_ACTIVATE_ID, SELF_IMPROVEMENT_PLUGIN } from './contracts.ts'

it('reexports frozen chat seat, Memory field names, and shared projectIdFromCwd', () => {
  const frozen = readFileSync(fileURLToPath(new URL('../../dsh-ai-services/src/contracts.ts', import.meta.url)), 'utf8')
  expect(CHAT_EVENTS_SLOT).toBe(FROZEN_SLOT)
  expect(projectIdFromCwd).toBe(frozenProjectId)
  expect(frozen).toContain('interface MemoryService')
  expect(frozen).toContain('promoteToGlobal')
  expect(frozen).toContain('interface MemoryMutationOptions')
  expect(frozen).toContain('export function projectIdFromCwd')
  expect(SELF_IMPROVEMENT_ACTIVATE_ID).toBe(SELF_IMPROVEMENT_PLUGIN)
})

it('uses the shared project path helper without 256-char truncation', () => {
  expect(projectIdFromCwd('D:\\work\\Novel\\')).toBe('D:/work/Novel')
  const left = `/${'a'.repeat(200)}/one`
  const right = `/${'a'.repeat(200)}/two`
  expect(projectIdFromCwd(left)).toBe(left)
  expect(projectIdFromCwd(right)).toBe(right)
  expect(projectIdFromCwd(left)).not.toBe(projectIdFromCwd(right))
})
