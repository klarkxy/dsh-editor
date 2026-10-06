import { describe, expect, it } from 'vitest'
import { errorMessage, type RpcResult } from './index.js'

describe('createRpcClient - legacy error mapping', () => {
  const messages = (key: string) => {
    const map: Record<string, string> = {
      'error.diskChanged': '磁盘上的文件已变化',
      'error.notFound': '未找到该文件',
      'error.sessionMissing': '会话已失效',
      'error.generic': '操作未能完成',
    }
    return map[key] || key
  }

  it('maps stale/version errors to diskChanged', () => {
    const stale: RpcResult = { ok: false, error: { code: 'STALE', message: 'version mismatch' } }
    expect(errorMessage(stale, undefined, messages)).toBe('磁盘上的文件已变化')

    const changed: RpcResult = { ok: false, error: { message: 'file changed on disk' } }
    expect(errorMessage(changed, undefined, messages)).toBe('磁盘上的文件已变化')
  })

  it('maps session errors to sessionMissing', () => {
    const notFound: RpcResult = { ok: false, error: { message: 'session-not-found' } }
    expect(errorMessage(notFound, undefined, messages)).toBe('会话已失效')

    const notLive: RpcResult = { ok: false, error: { message: 'session is not live' } }
    expect(errorMessage(notLive, undefined, messages)).toBe('会话已失效')
  })

  it('maps not-found errors to notFound', () => {
    const missing: RpcResult = { ok: false, error: { message: 'not-found' } }
    expect(errorMessage(missing, undefined, messages)).toBe('未找到该文件')

    const fileMissing: RpcResult = { ok: false, error: { message: 'file missing' } }
    expect(errorMessage(fileMissing, undefined, messages)).toBe('未找到该文件')
  })

  it('returns error message or generic fallback for unmatched codes', () => {
    const custom: RpcResult = { ok: false, error: { message: 'Custom error text' } }
    expect(errorMessage(custom, undefined, messages)).toBe('Custom error text')

    const unknown: RpcResult = { ok: false, error: { code: 'UNKNOWN' } }
    expect(errorMessage(unknown, undefined, messages)).toBe('操作未能完成')
  })
})
