import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)))
const shimSource = readFileSync(resolve(root, 'client-node-shims.cjs'), 'utf8')
const wrapSource = readFileSync(resolve(root, 'wrap-client.mjs'), 'utf8')

function createShims() {
  const sandbox = {
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    btoa,
    queueMicrotask,
    globalThis: {},
  }
  sandbox.globalThis = sandbox
  runInNewContext(`${shimSource}\nthis.shims = __createDshNodeShims()`, sandbox)
  return sandbox.shims
}

describe('client node shims', () => {
  it('supplies Buffer, stream, events, and util for DSH client require()', () => {
    const shims = createShims()
    const buf = shims.buffer.Buffer.from('测试')
    expect(shims.buffer.Buffer.isBuffer(buf)).toBe(true)
    expect(buf.toString()).toBe('测试')
    expect(shims.buffer.Buffer.concat([buf, shims.buffer.Buffer.from('!')]).toString()).toBe('测试!')
    expect(shims.buffer.Buffer.alloc(3, 7)[1]).toBe(7)
    const emitter = new shims.events.EventEmitter()
    let seen = 0
    emitter.once('x', () => {
      seen += 1
    })
    emitter.emit('x')
    emitter.emit('x')
    expect(seen).toBe(1)
    const child = function Child() {}
    shims.util.inherits(child, shims.events.EventEmitter)
    expect(new child()).toBeInstanceOf(shims.events.EventEmitter)
    expect(typeof shims.stream.Readable).toBe('function')
  })

  it('is injected by wrap-client so docx/jszip require() does not hit the DSH module table', () => {
    expect(wrapSource).toContain('client-node-shims.cjs')
    expect(wrapSource).toContain("id === 'buffer' || id === 'stream' || id === 'util' || id === 'events'")
    expect(wrapSource).toContain('__createDshNodeShims')
    expect(wrapSource).toContain('factory: (dshRequire)')
    expect(wrapSource).not.toContain('factory: (require)')
  })
})
