import { createRequestManager, type PanelRequest } from 'dsh-editor-panel-base/requests'

export type MemoryRequest = PanelRequest

const manager = createRequestManager<MemoryRequest>()

export function requestMemoryOpen(): MemoryRequest {
  return manager.request({ nonce: Date.now() })
}

export const pendingMemoryRequest = manager.pending
export const consumeMemoryRequest = manager.consume
export const subscribeMemoryRequest = manager.subscribe
