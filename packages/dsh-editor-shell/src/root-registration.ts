import type { Context } from '@deepseek-ai/cordis'
import type { RootOwnerProps } from '@deepseek-ai/dsh-client-runtime/client'
import { t } from './i18n/index.ts'
import { CENTER_OVERLAYS_SLOT, SIDEBAR_TOOLS_SLOT } from './seats.ts'

export const ROOT_ID = 'dsh-editor-shell-root'
export const EXTENSIONS_SLOT = 'dsh-editor.extensions'
export const PLUGINS_SETTINGS_SLOT = 'dsh-editor.settings.plugins'
export { CENTER_OVERLAYS_SLOT, SIDEBAR_TOOLS_SLOT }

export type RootSlots = { register: (spec: {
  name: 'root'
  id: string
  priority: number
  label: string
  children: Record<string, { kind: 'list'; scope: 'root' }>
}, render: unknown) => unknown }

/** The package deliberately wins the public root slot; no layout/conversation internals are imported. */
export function registerRoot(ctx: Context & { slots: RootSlots }, render: (props: RootOwnerProps) => unknown): unknown {
  return ctx.slots.register({
    name: 'root',
    id: ROOT_ID,
    priority: -100,
    label: t('app.slotLabel'),
    // Additive seats only: declaring shell.overlay here would awaken the
    // manuscript overlay, which belongs to the shadowed AppFrame. The plugins
    // settings seat is consumed by the settings dialog, not the chrome dock.
    children: {
      [EXTENSIONS_SLOT]: { kind: 'list', scope: 'root' },
      [PLUGINS_SETTINGS_SLOT]: { kind: 'list', scope: 'root' },
      [SIDEBAR_TOOLS_SLOT]: { kind: 'list', scope: 'root' },
      [CENTER_OVERLAYS_SLOT]: { kind: 'list', scope: 'root' },
    },
  }, render)
}
