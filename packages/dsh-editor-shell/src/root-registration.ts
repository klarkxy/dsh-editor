import { NATIVE_PLUGIN_MANAGER_SEAT } from './client/native-plugin-manager-seat.ts'
import { OFFICIAL_INPUT_SLOT } from './model/official-surfaces.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { RootOwnerProps } from './dsh-compat.ts'
import { t } from './i18n/index.ts'
import { CENTER_OVERLAYS_SLOT, SIDEBAR_TOOLS_SLOT, CHAT_EVENTS_SLOT, MODEL_SETTINGS_SLOT } from './seats.ts'

export const ROOT_ID = 'dsh-editor-shell-root'
export const EXTENSIONS_SLOT = 'dsh-editor.extensions'
export const PLUGINS_SETTINGS_SLOT = 'dsh-editor.settings.plugins'
export const OFFICIAL_SETTINGS_SLOT = 'settings.section'
export const ZHIHU_SETTINGS_SLOT = 'dsh-editor.settings.zhihu'
export { CENTER_OVERLAYS_SLOT, SIDEBAR_TOOLS_SLOT }

export type RootSlots = { register: (spec: {
  name: 'root'
  id: string
  priority: number
  label: string
  children: Record<string, { kind: 'list' | 'keyed' | 'single'; scope: 'root' | 'session' }>
}, render: unknown) => unknown }

/** The package deliberately wins the public root slot; no layout/conversation internals are imported. */
export function registerRoot(ctx: Context & { slots: RootSlots }, render: (props: RootOwnerProps) => unknown): unknown {
  return ctx.slots.register({
    name: 'root',
    id: ROOT_ID,
    priority: -100,
    label: t('app.slotLabel'),
    // Editor is the sole layout owner; official plugins retain their own child slots.
    children: {
      [OFFICIAL_INPUT_SLOT]: { kind: 'single', scope: 'session' },
      [NATIVE_PLUGIN_MANAGER_SEAT]: { kind: 'keyed', scope: 'root' },
      'rightbar': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
      [EXTENSIONS_SLOT]: { kind: 'list', scope: 'root' },
      [PLUGINS_SETTINGS_SLOT]: { kind: 'list', scope: 'root' },
      [OFFICIAL_SETTINGS_SLOT]: { kind: 'list', scope: 'root' },
      [ZHIHU_SETTINGS_SLOT]: { kind: 'list', scope: 'root' },
      [SIDEBAR_TOOLS_SLOT]: { kind: 'list', scope: 'root' },
      [CENTER_OVERLAYS_SLOT]: { kind: 'list', scope: 'root' },
      [CHAT_EVENTS_SLOT]: { kind: 'list', scope: 'root' },
      [MODEL_SETTINGS_SLOT]: { kind: 'list', scope: 'root' },
    },
  }, render)
}
