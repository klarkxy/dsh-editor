export class AiServicesError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'AiServicesError'
  }
}

export const AI_UNKNOWN_PURPOSE = 'AI_UNKNOWN_PURPOSE'
export const AI_UNKNOWN_ROLE = 'AI_UNKNOWN_ROLE'
export const AI_ROLE_UNSET = 'AI_ROLE_UNSET'
export const AI_INVALID_ROUTE = 'AI_INVALID_ROUTE'
export const AI_SESSION_UNAVAILABLE = 'AI_SESSION_UNAVAILABLE'
export const AI_SESSION_INVALID = 'AI_SESSION_INVALID'
export const AI_POLICY_CONFLICT = 'AI_POLICY_CONFLICT'
export const AI_POLICY_INVALID = 'AI_POLICY_INVALID'
export const AI_POLICY_SAVE_FAILED = 'AI_POLICY_SAVE_FAILED'
export const AI_DUPLICATE_PURPOSE = 'AI_DUPLICATE_PURPOSE'
export const AI_INACTIVE = 'AI_INACTIVE'
export const AI_INPUT_TOO_LARGE = 'AI_INPUT_TOO_LARGE'

export function fail(code: string, message: string): never {
  throw new AiServicesError(message, code)
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR' || code === 'ABORTED'
}

export async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let off = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
    signal.addEventListener('abort', onAbort, { once: true })
    off = () => signal.removeEventListener('abort', onAbort)
  })
  try {
    return await Promise.race([Promise.resolve().then(work), aborted])
  } finally { off() }
}

export function publicCallError(code: string): string {
  if (code === 'NO_ADAPTER') return '指定的模型供应不可用，未改用其他模型。'
  if (code === 'UNSUPPORTED_REASONING_EFFORT') return '该模型不支持所选推理强度，未改用其他设置。'
  if (code === 'INVALID_CREDENTIAL' || code === 'AUTH' || code === 'MISSING_CREDENTIAL') return '模型凭据不可用。'
  if (code === 'QUOTA') return '模型额度不足。'
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return '输入超出模型上下文。'
  return '模型调用失败。'
}
