import { describe, expect, it } from 'vitest'
import { createNavSaveGate } from './nav-save-gate.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('createNavSaveGate', () => {
  it('runs a queued navigation after the in-flight save, without a second save', async () => {
    const gate = createNavSaveGate()
    const save = deferred<boolean>()
    let saves = 0
    const first = gate(async () => { saves += 1; return save.promise })
    const queued = gate(async () => { saves += 1; return true })
    save.resolve(true)
    expect(await first).toBe(true)
    expect(await queued).toBe(true)
    expect(saves).toBe(1)
  })

  it('keeps only the latest queued navigation and drops earlier ones', async () => {
    const gate = createNavSaveGate()
    const save = deferred<boolean>()
    const first = gate(async () => save.promise)
    const older = gate(async () => true)
    const latest = gate(async () => true)
    save.resolve(true)
    await first
    expect(await older).toBe(false)
    expect(await latest).toBe(true)
  })

  it('blocks the queued navigation when the in-flight save fails', async () => {
    const gate = createNavSaveGate()
    const save = deferred<boolean>()
    let saves = 0
    const first = gate(async () => { saves += 1; return save.promise })
    const queued = gate(async () => { saves += 1; return true })
    save.resolve(false)
    expect(await first).toBe(false)
    expect(await queued).toBe(false)
    expect(saves).toBe(1)
  })

  it('releases queued waiters when the save throws', async () => {
    const gate = createNavSaveGate()
    const boom = deferred<never>()
    const first = gate(async () => boom.promise)
    const queued = gate(async () => true)
    boom.reject(new Error('rpc down'))
    await expect(first).rejects.toThrow('rpc down')
    expect(await queued).toBe(false)
  })

  it('saves again for requests that arrive after the in-flight save finished', async () => {
    const gate = createNavSaveGate()
    let saves = 0
    expect(await gate(async () => { saves += 1; return true })).toBe(true)
    expect(await gate(async () => { saves += 1; return true })).toBe(true)
    expect(saves).toBe(2)
  })
})
