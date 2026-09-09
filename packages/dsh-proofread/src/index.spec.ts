import { describe, expect, it } from 'vitest'
import { checkText } from './index.ts'
import { PROOFREAD_MAX_TEXT_BYTES } from './contracts.ts'
const signal = () => new AbortController().signal

describe('text-only proofreading RPC', () => {
  it('reports an ordinary Chinese typo without any workspace or model input', async () => {
    const response = await checkText('text.check', { text: '我们以经做好准备。', kinds: ['typo'] }, signal())
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.value.findings).toEqual([expect.objectContaining({ kind: 'typo', start: 2, end: 4, suggestion: '已经', path: '', version: '' })])
  })
  it('does not let callers inject file paths, dictionaries or raise internal budgets', async () => {
    for (const extras of [{ path: '../secret' }, { maxFindings: 1e9 }, { typos: [] }, { sessionId: 's' }]) {
      expect(await checkText('text.check', { text: '', ...extras }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
  })
  it('measures its limit in UTF-8 bytes and rejects card checks', async () => {
    expect(await checkText('text.check', { text: '中'.repeat(Math.floor(PROOFREAD_MAX_TEXT_BYTES / 3) + 1) }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await checkText('text.check', { text: '文本', kinds: ['card'] }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })
  it('returns bounded findings and an explicit truncation receipt', async () => {
    const response = await checkText('text.check', { text: '按装。'.repeat(520), kinds: ['typo'] }, signal())
    expect(response.ok).toBe(true)
    if (response.ok) { expect(response.value.findings).toHaveLength(500); expect(response.value.truncated).toBe(true) }
  })
  it('keeps empty success, malformed requests and cancellation distinguishable', async () => {
    expect(await checkText('text.check', { text: '' }, signal())).toMatchObject({ ok: true, value: { findings: [], truncated: false } })
    for (const payload of [null, [], {}, { text: 1 }, { text: '', kinds: 'typo' }]) {
      expect(await checkText('text.check', payload, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(await checkText('unknown', { text: '' }, signal())).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await checkText('text.check', { text: '按装' }, AbortSignal.abort())).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
