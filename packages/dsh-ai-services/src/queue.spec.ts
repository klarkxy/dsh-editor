import { describe, expect, it } from 'vitest'
import { ProviderQueue } from './queue.ts'

function wait(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)) }

describe('per-provider concurrency', () => {
  it('runs interactive waiters before background when a slot opens', async () => {
    const queue = new ProviderQueue(() => 1)
    const order: string[] = []
    const first = await queue.acquire('background', new AbortController().signal)
    const background = queue.acquire('background', new AbortController().signal).then(release => {
      order.push('background')
      release()
    })
    await wait()
    const interactive = queue.acquire('interactive', new AbortController().signal).then(release => {
      order.push('interactive')
      release()
    })
    await wait()
    first()
    await Promise.all([background, interactive])
    expect(order).toEqual(['interactive', 'background'])
  })

  it('holds background work while an agent stream occupies the provider', async () => {
    const queue = new ProviderQueue(() => 1)
    queue.noteAgent(1)
    let started = false
    const pending = queue.acquire('background', new AbortController().signal).then(release => {
      started = true
      release()
    })
    await wait()
    expect(started).toBe(false)
    const interactive = await queue.acquire('interactive', new AbortController().signal)
    expect(queue.runningCount).toBe(1)
    interactive()
    queue.noteAgent(-1)
    await pending
    expect(started).toBe(true)
  })

  it('does not start a cancelled waiter', async () => {
    const queue = new ProviderQueue(() => 1)
    const hold = await queue.acquire('background', new AbortController().signal)
    const controller = new AbortController()
    const pending = queue.acquire('background', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    hold()
    await wait()
    const late = await queue.acquire('background', new AbortController().signal)
    late()
  })

  it('does not keep an abort listener as a waiter after a grant', async () => {
    const queue = new ProviderQueue(() => 1)
    const hold = await queue.acquire('background', new AbortController().signal)
    const controller = new AbortController()
    const pending = queue.acquire('background', controller.signal)
    await wait()
    expect(queue.waiterCount).toBe(1)
    hold()
    const release = await pending
    expect(queue.waiterCount).toBe(0)
    expect(queue.runningCount).toBe(1)
    controller.abort()
    await wait()
    expect(queue.waiterCount).toBe(0)
    expect(queue.runningCount).toBe(1)
    release()
    expect(queue.runningCount).toBe(0)
  })

  it('fills newly available capacity without waiting for another wake', async () => {
    let limit = 1
    const queue = new ProviderQueue(() => limit)
    const started: number[] = []
    const first = await queue.acquire('background', new AbortController().signal)
    const second = queue.acquire('background', new AbortController().signal).then(release => {
      started.push(2)
      return release
    })
    const third = queue.acquire('background', new AbortController().signal).then(release => {
      started.push(3)
      return release
    })
    await wait()
    expect(started).toEqual([])
    expect(queue.waiterCount).toBe(2)
    limit = 3
    queue.wake()
    await wait()
    expect(started.sort()).toEqual([2, 3])
    expect(queue.waiterCount).toBe(0)
    expect(queue.runningCount).toBe(3)
    first()
    ;(await second)()
    ;(await third)()
    expect(queue.runningCount).toBe(0)
    expect(queue.waiterCount).toBe(0)
  })
})
