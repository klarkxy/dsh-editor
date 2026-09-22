export type QueuePriority = 'interactive' | 'background'

type Waiter = {
  priority: QueuePriority
  signal: AbortSignal
  resume: () => void
  reject: (error: unknown) => void
  dispose: () => void
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
}

/** Per-provider limiter: interactive waiters before background; background yields to in-flight agent streams. */
export class ProviderQueue {
  private running = 0
  private agent = 0
  private waiters: Waiter[] = []

  constructor(private readonly limit: () => number) {}

  noteAgent(delta: 1 | -1 | 0): void {
    if (delta !== 0) this.agent = Math.max(0, this.agent + delta)
    this.pump()
  }

  wake(): void {
    this.pump()
  }

  get agentCount(): number { return this.agent }
  get runningCount(): number { return this.running }
  get waiterCount(): number { return this.waiters.length }

  async acquire(priority: QueuePriority, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.tryAcquire(priority)) return () => this.release()
    await new Promise<void>((resolve, reject) => {
      let waiter: Waiter
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index < 0) return
        this.waiters.splice(index, 1)
        waiter.dispose()
        reject(abortError(signal))
      }
      waiter = {
        priority,
        signal,
        resume: resolve,
        reject,
        dispose: () => signal.removeEventListener('abort', onAbort),
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.enqueue(waiter)
      this.pump()
    })
    return () => this.release()
  }

  private enqueue(waiter: Waiter): void {
    if (waiter.priority === 'interactive') {
      const index = this.waiters.findIndex(item => item.priority === 'background')
      this.waiters.splice(index === -1 ? this.waiters.length : index, 0, waiter)
      return
    }
    this.waiters.push(waiter)
  }

  private canStart(priority: QueuePriority): boolean {
    if (this.running >= this.limit()) return false
    if (priority === 'background' && this.agent > 0) return false
    return true
  }

  private tryAcquire(priority: QueuePriority): boolean {
    if (!this.canStart(priority)) return false
    this.running += 1
    return true
  }

  private release(): void {
    this.running = Math.max(0, this.running - 1)
    this.pump()
  }

  private pump(): void {
    while (true) {
      const index = this.waiters.findIndex(waiter => this.canStart(waiter.priority))
      if (index < 0) return
      const waiter = this.waiters[index]!
      if (!this.tryAcquire(waiter.priority)) return
      this.waiters.splice(index, 1)
      waiter.dispose()
      waiter.resume()
    }
  }
}

export class ProviderQueues {
  private readonly queues = new Map<string, ProviderQueue>()
  constructor(private readonly limit: () => number) {}

  forProvider(provider: string): ProviderQueue {
    let queue = this.queues.get(provider)
    if (!queue) {
      queue = new ProviderQueue(this.limit)
      this.queues.set(provider, queue)
    }
    return queue
  }

  noteAgent(provider: string, delta: 1 | -1): void {
    this.forProvider(provider).noteAgent(delta)
  }

  wake(): void {
    for (const queue of this.queues.values()) queue.wake()
  }
}
