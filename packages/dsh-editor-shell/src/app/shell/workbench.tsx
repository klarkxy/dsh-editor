import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, type PanelSize } from 'react-resizable-panels'
import { Drawer } from '../../ui/index.ts'
import { t } from '../../i18n/index.ts'
import type { AuxTab } from '../../model/workbench-layout.ts'
import type { WorkbenchLayoutController } from './use-workbench-layout.ts'
import { panelPixels } from '../../model/root-columns.ts'
import './shell.styles.ts'

const IME_KEYCODE = 229

/*
 * 输入淡化（spec §2.2）：在稿纸区里连续输入两个普通键之后，在外框根元素
 * 上置 data-typing，两侧栏与顶栏随淡出；任一解除条件即清掉。
 * 属性落在 .dsh-root 上：窄窗抽屉是 Portal，不挂在 .dsh-frame 下面。
 */
function useTypingDim(frameRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const scope = frame.closest('.dsh-root') ?? frame
    let streak = 0
    const clear = () => {
      streak = 0
      scope.removeAttribute('data-typing')
    }
    const inPaper = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('.editor .cm-content, .paper-input .cm-content'))
    const overlaySelector = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [cmdk-list]'
    const observer = new MutationObserver(() => {
      if (document.querySelector(overlaySelector)) clear()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const onKeydown = (event: KeyboardEvent) => {
      if (!inPaper(event.target)) { streak = 0; return }
      if (event.isComposing || event.keyCode === IME_KEYCODE) return
      if (event.ctrlKey || event.metaKey || event.altKey) { clear(); return }
      if (event.key.length !== 1 && event.key !== 'Backspace' && event.key !== 'Delete' && event.key !== 'Enter') { clear(); return }
      streak += 1
      if (streak >= 2) scope.setAttribute('data-typing', 'true')
    }
    const onPointer = () => clear()
    const onFocusIn = (event: FocusEvent) => {
      if (!inPaper(event.target)) clear()
    }
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('mousemove', onPointer, { passive: true })
    document.addEventListener('pointerdown', onPointer, { passive: true })
    document.addEventListener('focusin', onFocusIn)
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeydown)
      document.removeEventListener('mousemove', onPointer)
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('focusin', onFocusIn)
      scope.removeAttribute('data-typing')
    }
  }, [frameRef])
}

/*
 * 栏内容托管：宿主 div 一次挂载后按当前形态（网格槽 / 抽屉槽 / 停泊区）
 * 直接挪 DOM 位置，React 子树（聊天草稿、目录展开态、滚动位置）不重建。
 * 抽屉关闭时 Radix 会拆掉抽屉的 DOM 子树，宿主节点随子树短暂脱离文档，
 * 本 effect 在同一轮提交里把它挂回停泊区，节点对象不变，React 引用不失效。
 */
function usePaneAdoption(
  hostRef: RefObject<HTMLDivElement | null>,
  pick: () => HTMLElement | null,
): () => void {
  /* pick 要总是最新的：回调 ref 在抽屉内容真正挂载的那轮提交里触发。 */
  const pickRef = useRef(pick)
  pickRef.current = pick
  const adopt = useCallback(() => {
    const host = hostRef.current
    const slot = pickRef.current()
    if (host && slot && host.parentElement !== slot) slot.appendChild(host)
  }, [hostRef])
  /* 网格槽/停泊区与 open 翻转同轮就位；抽屉槽由调用方把 adopt 挂成回调 ref，
     在抽屉内容实际挂载时补一次（Radix Presence 延迟一轮提交）。 */
  useEffect(adopt)
  return adopt
}

export function Workbench(props: {
  layout: WorkbenchLayoutController
  files: ReactNode
  aux: ReactNode
  paper: ReactNode
  launcher?: ReactNode
}) {
  const { layout } = props
  const frameRef = useRef<HTMLDivElement>(null)
  const parkRef = useRef<HTMLDivElement>(null)
  const filesHostRef = useRef<HTMLDivElement>(null)
  const auxHostRef = useRef<HTMLDivElement>(null)
  const filesGridSlotRef = useRef<HTMLDivElement>(null)
  const auxGridSlotRef = useRef<HTMLDivElement>(null)
  const filesDrawerSlotRef = useRef<HTMLDivElement | null>(null)
  const auxDrawerSlotRef = useRef<HTMLDivElement | null>(null)

  useTypingDim(frameRef)

  /* Esc 在专注模式下退出专注；对话框/菜单开着时先让 Radix 处理。 */
  const focusRef = useRef(false)
  focusRef.current = layout.layout.focus
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !focusRef.current) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      layout.exitFocus()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [layout])

  const adoptFiles = usePaneAdoption(filesHostRef, () => {
    if (layout.filesInGrid && filesGridSlotRef.current) return filesGridSlotRef.current
    if (layout.filesDrawerOpen && filesDrawerSlotRef.current) return filesDrawerSlotRef.current
    return parkRef.current
  })
  const filesDrawerSlotCb = useCallback((el: HTMLDivElement | null) => {
    filesDrawerSlotRef.current = el
    if (el) adoptFiles()
  }, [adoptFiles])

  const adoptAux = usePaneAdoption(auxHostRef, () => {
    if (layout.auxInGrid && auxGridSlotRef.current) return auxGridSlotRef.current
    if (layout.auxDrawerOpen && auxDrawerSlotRef.current) return auxDrawerSlotRef.current
    return parkRef.current
  })
  const auxDrawerSlotCb = useCallback((el: HTMLDivElement | null) => {
    auxDrawerSlotRef.current = el
    if (el) adoptAux()
  }, [adoptAux])

  const persistWidths = (_sizes: unknown, meta: { isUserInteraction?: boolean }) => {
    /* 拖动中途不要 setState：v4 会把变化中的 defaultSize 当成新布局，pointer capture 也会丢。 */
    if (!meta.isUserInteraction) return
    layout.setFilesWidth(layout.filesWidthRef.current)
    layout.setAuxWidth(layout.auxWidthRef.current)
  }

  return (
    <div className="dsh-frame" ref={frameRef} data-testid="dsh-shell-frame">
      <PanelGroup
        orientation="horizontal"
        className="dsh-workbench-grid"
        resizeTargetMinimumSize={{ coarse: 28, fine: 12 }}
        onLayoutChanged={persistWidths}>
        {layout.filesInGrid ? <Panel
          id="files"
          className="shell-panel"
          minSize={200}
          maxSize={440}
          defaultSize={layout.filesViewWidth}
          panelRef={layout.filesPanelRef}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size: PanelSize) => { if (size.inPixels > 0) layout.filesWidthRef.current = panelPixels(size) }}
        >
          <div ref={filesGridSlotRef} className="dsh-pane-slot" data-testid="dsh-shell-files-pane" />
        </Panel> : null}
        {layout.filesInGrid ? <PanelResizeHandle
          className="panel-resizer panel-resizer-files"
          aria-label={t('workspace.resizeFiles')}
          title={t('resizer.aria', { label: t('workspace.resizeFiles') })} /> : null}
        <Panel id="paper" minSize={420} className="shell-panel editor-cell">
          {props.paper}
        </Panel>
        {layout.auxInGrid ? <PanelResizeHandle
          className="panel-resizer panel-resizer-aux"
          aria-label={t('workspace.resizeAssistant')}
          title={t('resizer.aria', { label: t('workspace.resizeAssistant') })} /> : null}
        {layout.auxInGrid ? <Panel
          id="aux"
          className="shell-panel"
          minSize={320}
          maxSize={640}
          defaultSize={layout.auxViewWidth}
          panelRef={layout.auxPanelRef}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size: PanelSize) => { if (size.inPixels > 0) layout.auxWidthRef.current = panelPixels(size) }}
        >
          <div ref={auxGridSlotRef} className="dsh-pane-slot" data-testid="dsh-shell-aux-pane" />
        </Panel> : null}
      </PanelGroup>

      {/* 停泊区：栏内容一次挂载后跨形态复用，不进任何 React 卸载路径。 */}
      <div ref={parkRef} hidden>
        <div ref={filesHostRef} className="dsh-pane dsh-pane--files">{props.files}</div>
        <div ref={auxHostRef} className="dsh-pane dsh-pane--aux">{props.aux}</div>
      </div>

      <Drawer
        open={layout.filesDrawerOpen}
        onOpenChange={(open) => { if (!open) layout.setFilesOpen(false) }}
        side="left"
        title={t('workspace.files')}
        closeLabel={t('common.close')}>
        <div ref={filesDrawerSlotCb} className="dsh-pane-slot" />
      </Drawer>
      <Drawer
        open={layout.auxDrawerOpen}
        onOpenChange={(open) => { if (!open) layout.setAuxOpen(false) }}
        side="right"
        title={auxDrawerTitle(layout.layout.aux.tab)}
        closeLabel={t('common.close')}>
        <div ref={auxDrawerSlotCb} className="dsh-pane-slot" />
      </Drawer>

      {props.launcher}
    </div>
  )
}

function auxDrawerTitle(tab: AuxTab): string {
  if (tab === 'tools') return t('aux.tabTools')
  if (tab === 'reference') return t('aux.tabReference')
  return t('aux.tabPartner')
}
