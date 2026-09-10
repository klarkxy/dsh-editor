export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'READ_ONLY' | 'INVALID_PATH' | 'NOT_FOUND' | 'EXISTS' | 'STALE' | 'BLOCKED' | 'UNSUPPORTED' | 'IO',
    options?: ErrorOptions,
    readonly recoveryPath?: string,
  ) {
    super(message, options)
    this.name = 'LifecycleError'
  }
}
