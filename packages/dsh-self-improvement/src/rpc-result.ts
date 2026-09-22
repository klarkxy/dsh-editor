import type { RpcResult } from './contracts.ts'

export function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
