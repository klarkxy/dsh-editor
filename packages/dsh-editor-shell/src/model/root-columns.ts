import type { PanelSize } from 'react-resizable-panels'

export const panelPixels = (size: PanelSize): number => Math.round(size.inPixels)
