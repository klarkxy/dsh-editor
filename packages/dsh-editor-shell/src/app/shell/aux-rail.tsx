import { useEffect, useState, type ReactNode } from 'react'
import { SegmentedControl, Tab, TabList, TabPanel, Tabs } from '../../ui/index.ts'
import { t } from '../../i18n/index.ts'
import { useLocale } from '../../i18n/index.ts'
import type { AuxTab } from '../../model/workbench-layout.ts'

/*
 * 辅助栏（spec §2.1）：三个页签 —— 「搭档」承载对话，「资料」承载钉住预览
 * 与官方 rightbar，「工具」承载 sidebar 工具贡献（没有贡献时隐藏页签）。
 * 页签面板 forceMount：对话草稿、钉住栏滚动位置不随切页签重建。
 */
export function AuxRail(props: {
  tab: AuxTab
  onTabChange(tab: AuxTab): void
  hasTools: boolean
  partner: ReactNode
  reference: ReactNode
  tools: ReactNode
}) {
  useLocale()
  return (
    <Tabs
      value={props.tab}
      onValueChange={(value) => props.onTabChange(value as AuxTab)}
      className="dsh-aux-rail">
      <TabList aria-label={t('aux.tabs')} className="dsh-aux-rail__tabs">
        <Tab value="partner">{t('aux.tabPartner')}</Tab>
        <Tab value="reference">{t('aux.tabReference')}</Tab>
        {props.hasTools ? <Tab value="tools">{t('aux.tabTools')}</Tab> : null}
      </TabList>
      <TabPanel value="partner" forceMount className="dsh-aux-panel">{props.partner}</TabPanel>
      <TabPanel value="reference" forceMount className="dsh-aux-panel">{props.reference}</TabPanel>
      {props.hasTools ? <TabPanel value="tools" forceMount className="dsh-aux-panel">{props.tools}</TabPanel> : null}
    </Tabs>
  )
}

type ReferenceSegment = 'pinned' | 'preview'

/** 「资料」页签内容：钉住的文稿与官方 rightbar 预览之间切换。 */
export function ReferencePanel(props: {
  pinnedPath: string | null
  previewOpen: boolean
  onPreviewOpenChange(open: boolean): void
  pinned: ReactNode
  preview: ReactNode
}) {
  useLocale()
  const [segment, setSegment] = useState<ReferenceSegment>(props.previewOpen ? 'preview' : 'pinned')
  useEffect(() => {
    if (props.previewOpen) setSegment('preview')
  }, [props.previewOpen])
  /* 钉住与预览同时存在才给切换器；只有一个时直接呈现，没有时给空态。 */
  const both = Boolean(props.pinnedPath) && props.previewOpen
  const shown = both ? segment : props.previewOpen ? 'preview' : 'pinned'
  return (
    <div className="dsh-reference" data-testid="dsh-shell-reference">
      {both ? (
        <div className="dsh-aux-panel__head">
          <SegmentedControl
            aria-label={t('aux.referenceSwitch')}
            value={shown}
            onValueChange={(value) => {
              const next = value as ReferenceSegment
              setSegment(next)
              props.onPreviewOpenChange(next === 'preview')
            }}
            options={[
              { value: 'pinned', label: t('aux.referencePinned') },
              { value: 'preview', label: t('aux.referencePreview') },
            ]} />
        </div>
      ) : null}
      {/* 官方 rightbar 会话表面必须常驻挂载（旧 shell 的 aside 也是 hidden 常驻）：
          卸载后再打开会得到「sidebarRight: no session surface is mounted」。 */}
      <div className="dsh-reference__preview" hidden={shown !== 'preview'}>{props.preview}</div>
      {shown === 'preview' ? null : (
        props.pinnedPath ? props.pinned : (
          <div className="dsh-aux-panel__empty" role="status">{t('aux.referenceEmpty')}</div>
        )
      )}
    </div>
  )
}
