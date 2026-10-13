import { useLocale } from '../i18n/index.ts'
import { t } from '../i18n/index.ts'
import { PluginIcon, SettingsIcon } from './icons.tsx'
import { IconButton } from '@radix-ui/themes'

export type { SettingsRenderSlot } from './settings-plugins.tsx'

/** 顶栏设置入口。保留 .native-settings-control 包裹约定（e2e 依赖）。 */
export function SettingsTrigger(props: { onOpen(): void }) {
  useLocale()
  return (
    <span className="native-settings-control">
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        size="2"
        className="settings-trigger"
        aria-label={t('common.settings')}
        title={t('common.settings')}
        onClick={props.onOpen}>
        <span className="settings-trigger-icon" aria-hidden={true}>
          <SettingsIcon size={16} />
        </span>
      </IconButton>
    </span>
  );
}

/** 顶栏插件入口：进入全页设置的插件分区。 */
export function PluginsTrigger(props: { onOpen(): void }) {
  useLocale()
  return <IconButton type="button" variant="ghost" color="gray" size="2" className="plugins-trigger"
    aria-label={t('plugins.open')} title={t('plugins.open')} onClick={props.onOpen}>
    <PluginIcon size={18} />
  </IconButton>
}
