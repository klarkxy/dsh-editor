/* 导航保存闸门：任意时刻最多一个在飞保存。保存进行中到来的请求排队等待，
   在飞保存结束后只放行最后一个（更新的导航意图），更早的请求按被取代处理
   返回 false——排队请求自身不再发起第二次保存；在飞保存失败时，最后一个
   排队者同样拿到 false。 */
export function createNavSaveGate() {
  let busy = false
  const waiters: Array<(ok: boolean) => void> = []
  return async function gate(save: () => Promise<boolean>): Promise<boolean> {
    if (busy) {
      return await new Promise<boolean>((resolve) => { waiters.push(resolve) })
    }
    busy = true
    let ok = false
    try {
      ok = await save()
      return ok
    } finally {
      busy = false
      const queued = waiters.splice(0)
      const last = queued.pop()
      for (const waiter of queued) waiter(false)
      if (last) last(ok)
    }
  }
}
