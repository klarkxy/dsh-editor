import { describe, expect, it } from 'vitest'
import {
  extractFimText,
  isOfficialDeepSeekProvider,
  officialFimUrl,
  shouldFallbackBeta,
} from './fim-route.ts'

describe('fim route', () => {
  it('treats deepseek-official and api.deepseek.com as official', () => {
    expect(isOfficialDeepSeekProvider('deepseek-official')).toBe(true)
    expect(isOfficialDeepSeekProvider('new-api', 'https://newapi.klarkxy.xyz')).toBe(false)
    expect(isOfficialDeepSeekProvider('gateway', 'https://api.deepseek.com/v1')).toBe(true)
  })

  it('builds the documented beta completions URL', () => {
    expect(officialFimUrl()).toBe('https://api.deepseek.com/beta/completions')
    expect(officialFimUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/beta/completions')
  })

  it('falls back only for protocol gaps', () => {
    expect(shouldFallbackBeta(400, 'bad request')).toBe(true)
    expect(shouldFallbackBeta(404, 'missing')).toBe(true)
    expect(shouldFallbackBeta(401, 'unauthorized')).toBe(false)
    expect(shouldFallbackBeta(429, 'rate limit')).toBe(false)
    expect(shouldFallbackBeta(undefined, 'unsupported fim')).toBe(true)
  })

  it('reads OpenAI completion text', () => {
    expect(extractFimText({ choices: [{ text: '雾还没散。' }] })).toBe('雾还没散。')
    expect(extractFimText({ choices: [{ message: { content: '下一句' } }] })).toBe('下一句')
    expect(extractFimText({})).toBe('')
  })
})
