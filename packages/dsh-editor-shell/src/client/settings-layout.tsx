import type { ReactNode } from 'react'
import { Card, Flex, Text } from '../ui/index.ts'

/** 设置分区组：标题在卡片外，卡片承载行项；标题用 settings-group__title 统一样式。 */
export function SettingsGroup(props: { title: string; children: ReactNode; className?: string; id?: string; ariaLabel?: string }) {
  return (
    <section className={props.className ? `settings-group ${props.className}` : 'settings-group'} aria-label={props.ariaLabel}>
      <h3 className="settings-group__title" id={props.id}>{props.title}</h3>
      <Card className="settings-block">{props.children}</Card>
    </section>
  )
}

/** 卡片内的单行设置项：左标题/说明，右控件。 */
export function SettingRow(props: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Flex className="settings-row" align="center" justify="between" gap="4" py="3">
      <Flex direction="column" className="settings-row-text" gap="1" minWidth="0">
        <Text size="2" weight="medium" className="settings-row-title">
          {props.title}
        </Text>
        {props.description ? <Text size="1" color="gray" className="settings-row-description">
          {props.description}
        </Text> : null}
      </Flex>
      {props.children}
    </Flex>
  )
}
