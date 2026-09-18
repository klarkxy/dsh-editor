// llm/stream 用量包装：消费方提前退出时必须关掉底层迭代器。
// finally 里的关闭或记量失败不能覆盖上游已经抛出的异常。

export type UsageChunk = { type: string; usage?: Record<string, number> }

export async function* trackUsageStream<T extends UsageChunk>(
  source: AsyncIterable<T>,
  record: (usage: Record<string, number>, completed: boolean) => void | Promise<void>,
  onRecordError?: (error: unknown) => void,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  let lastUsage: Record<string, number> | undefined
  let observed = false
  let completed = false
  let streamError: unknown
  try {
    while (true) {
      const result = await iterator.next()
      if (result.done) {
        completed = true
        break
      }
      if (result.value?.type === 'usage' && result.value.usage) {
        lastUsage = result.value.usage
        observed = true
      }
      yield result.value
    }
  } catch (error) {
    streamError = error
    throw error
  } finally {
    if (!completed) {
      try {
        await iterator.return?.()
      } catch (closeError) {
        if (streamError === undefined) throw closeError
      }
    }
    if (observed) {
      try {
        await record(lastUsage ?? {}, completed)
      } catch (recordError) {
        try {
          onRecordError?.(recordError)
        } catch {
          // 记量日志本身失败也不能影响流。
        }
      }
    }
  }
}
