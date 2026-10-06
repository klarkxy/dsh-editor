import { createRequestManager, type PanelRequest } from 'dsh-editor-panel-base/requests'

export type OverviewRequest = PanelRequest

const manager = createRequestManager<OverviewRequest>()

export function requestOverview(): OverviewRequest {
  return manager.request({ nonce: Date.now() })
}

export const pendingOverviewRequest = manager.pending
export const consumeOverviewRequest = manager.consume
export const subscribeOverviewRequest = manager.subscribe
