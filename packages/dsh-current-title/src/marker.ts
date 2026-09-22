import type { TitleClientMarker, TitleStatus } from './contracts.ts'

export function createTitleClientMarker(): TitleClientMarker {
  return { active: false }
}

export function applyMarkerFromStatus(marker: TitleClientMarker, status: Pick<TitleStatus, 'support'> | undefined, live: boolean): void {
  if (!live) return
  marker.active = status?.support.weOwn === true
}

export function disposeTitleClientMarker(marker: TitleClientMarker): void {
  marker.active = false
}
