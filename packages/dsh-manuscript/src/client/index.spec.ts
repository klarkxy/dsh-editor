import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')

describe('manuscript client boundaries', () => {
  it('keeps proposal consumption and DOM composer injection out of the standalone client', () => {
    expect(source).not.toMatch(/proposal\.(list|accept|reject)/)
    expect(source).not.toContain('querySelectorAll')
    expect(source).not.toContain('file.rename')
    expect(source).toContain('clipboard.writeText')
  })

  it('uses the server-authoritative session id for every manuscript RPC', () => {
    expect(source).not.toMatch(/\{ cwd:/)
    expect(source).toContain('sessionId: current.sessionId')
    expect(source).toContain('sessionId: props.sessionId')
  })

  it('preserves an unsaved draft across close, unload, and workspace changes', () => {
    expect(source).toContain("addEventListener('beforeunload'")
    expect(source).toContain('关闭稿纸后会保留草稿')
    expect(source).toContain('保存后切换')
    expect(source).toContain('放弃修改并切换')
  })
})
