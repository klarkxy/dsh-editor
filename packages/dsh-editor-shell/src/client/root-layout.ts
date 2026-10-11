import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { SessionFace, WorkspaceId } from '../dsh-compat.ts'
import { safeRpcCall, storedPanelOpen, storedPanelWidth, type ShellContext } from './shared.ts'
import { railAtWidth, railByAuthor, railPanelSync, type RailYieldState } from './narrow-layout.ts'
import { useMediaQuery } from './components.tsx'
import { type PanelImperativeHandle } from 'react-resizable-panels'
import { isSingleManuscriptRoot, readSingleSidebarChoice, sidebarAfterManuscriptCensus, writeSingleSidebarChoice } from './sidebar-chrome.ts'
import { canPinPath, storedPinnedPath } from '../pinned-pane-view.ts'

export const SIDEBAR_DEFAULT = 260
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 440
export const ASSISTANT_DEFAULT = 400
export const ASSISTANT_MIN = 320
export const ASSISTANT_MAX = 640
export const PINNED_DEFAULT = 360
export const PINNED_MIN = 280
export const PINNED_MAX = 520

// The author owns persisted rail choices; width-driven changes stay transient.
export function useRootLayout({ ctx, fileSession, openWorkspaceId, treeRevision, assistantEnabled, officialPreviewOpen }: {
  ctx: ShellContext
  fileSession?: SessionFace
  openWorkspaceId?: WorkspaceId
  treeRevision: number
  assistantEnabled: boolean
  officialPreviewOpen: boolean
}) {
  const [sidebarOpen, setSidebarOpen] = useState(() => storedPanelOpen('dsh-editor.layout.sidebar-open', true))
  const sidebarOpenRef = useRef(sidebarOpen)
  sidebarOpenRef.current = sidebarOpen
  const sidebarAutoCollapsed = useRef(false)
  /* 落盘开合偏好由作者拥有：窗口让位和单稿件自动收起只是这一次窗口的结果，
     写进 localStorage 就等于永久改掉作者的布局。早期实现用「跳过下一次落盘」
     的布尔量：挂载时结算与落盘副作用在同一次提交里按声明顺序执行，落盘副作用
     先把这个标记消费掉，等让位后的新值真的落盘时标记已经没了——窄窗重载一次，
     搭档栏的 true 就被写成 false。改成「当前这个 open 值是不是作者的选择」的
     状态量：只有作者自己开合才重新打开落盘，任何跳过都不靠消费次数。 */
  const sidebarOpenDriven = useRef(false)
  const rootSingleRef = useRef(false)
  const sidebarChoicePending = useRef<boolean | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => storedPanelWidth('dsh-editor.layout.sidebar-width', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX))
  const [assistantOpen, setAssistantOpen] = useState(() => storedPanelOpen('dsh-editor.layout.assistant-open', true))
  const [assistantWidth, setAssistantWidth] = useState(() => storedPanelWidth('dsh-editor.layout.assistant-width', ASSISTANT_DEFAULT, ASSISTANT_MIN, ASSISTANT_MAX))
  const overlayAssistant = useMediaQuery('(max-width: 1040px)')
  const compactChrome = useMediaQuery('(max-width: 760px)')
  // A window that cannot fit both rails beside the paper is a transient
  // condition, not a layout change the author asked for. Both rails yield to
  // the manuscript and their stored preference is left untouched, so widening
  // the window back restores the author's own layout instead of the collapse
  // silently becoming their new default.
  const sidebarRail = useRef<RailYieldState>({ yielded: null, crowded: compactChrome, authored: false })
  const assistantRail = useRef<RailYieldState>({ yielded: null, crowded: overlayAssistant, authored: false })
  const assistantOpenDriven = useRef(false)
  // 宽度驱动的收起走这里：作者原本的选择留在 yielded 里，不写进 localStorage。
  const settleRail = useCallback((
    rail: MutableRefObject<RailYieldState>,
    open: boolean,
    crowded: boolean,
    force: boolean,
    apply: (next: boolean) => void,
    driven: MutableRefObject<boolean>,
  ) => {
    const next = railAtWidth({ open, ...rail.current }, crowded, force)
    if (next.yielded === rail.current.yielded
      && next.authored === rail.current.authored
      && next.crowded === rail.current.crowded
      && next.open === open) return
    rail.current = { yielded: next.yielded, authored: next.authored, crowded: next.crowded }
    if (next.open === open) return
    // 这一次的开合是窗口替作者决定的，不落盘；只标记这一条栏，另一条栏不受影响。
    driven.current = true
    apply(next.open)
  }, [])
  // 窄窗下两条栏互斥时用强制让位，作者对其中一条的接管不阻止另一条让位。
  const yieldSidebarToWidth = useCallback(() => {
    settleRail(sidebarRail, sidebarOpen, true, true, setSidebarOpen, sidebarOpenDriven)
  }, [settleRail, sidebarOpen])
  const yieldAssistantToWidth = useCallback(() => {
    settleRail(assistantRail, assistantOpen, true, true, setAssistantOpen, assistantOpenDriven)
  }, [settleRail, assistantOpen])
  useEffect(() => { settleRail(sidebarRail, sidebarOpen, compactChrome, false, setSidebarOpen, sidebarOpenDriven) }, [compactChrome, sidebarOpen, settleRail])
  useEffect(() => { settleRail(assistantRail, assistantOpen, overlayAssistant, false, setAssistantOpen, assistantOpenDriven) }, [overlayAssistant, assistantOpen, settleRail])
  // 作者自己开合：记下接管，窗口规则在换档前不再替他改动，同时把落盘权还给作者。
  const claimSidebar = useCallback((open: boolean) => {
    sidebarOpenDriven.current = false
    const next = railByAuthor(open, compactChrome)
    sidebarRail.current = { yielded: next.yielded, crowded: next.crowded, authored: next.authored }
  }, [compactChrome])
  const claimAssistant = useCallback((open: boolean) => {
    assistantOpenDriven.current = false
    const next = railByAuthor(open, overlayAssistant)
    assistantRail.current = { yielded: next.yielded, crowded: next.crowded, authored: next.authored }
  }, [overlayAssistant])
  const [pinnedPath, setPinnedPath] = useState<string | null>(() => {
    const stored = storedPinnedPath('dsh-editor.layout.pinned-path')
    return stored && canPinPath(stored) ? stored : null
  })
  const [pinnedWidth, setPinnedWidth] = useState(() => storedPanelWidth('dsh-editor.layout.pinned-width', PINNED_DEFAULT, PINNED_MIN, PINNED_MAX))
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  const assistantWidthRef = useRef(assistantWidth)
  const pinnedWidthRef = useRef(pinnedWidth)
  const [focusMode, setFocusMode] = useState(false)
  useEffect(() => {
    // 窗口让位或单稿件自动收起的结果不落盘：作者下次自己开合时才写。
    if (sidebarOpenDriven.current) return
    try { globalThis.localStorage?.setItem('dsh-editor.layout.sidebar-open', String(sidebarOpen)) } catch { /* View preferences remain optional. */ }
  }, [sidebarOpen])
  const openWorkspaceIdRef = useRef(openWorkspaceId)
  openWorkspaceIdRef.current = openWorkspaceId
  const noteSidebarChoice = (open: boolean) => {
    sidebarAutoCollapsed.current = false
    if (!rootSingleRef.current) {
      sidebarChoicePending.current = open
      return
    }
    sidebarChoicePending.current = null
    writeSingleSidebarChoice(openWorkspaceIdRef.current, open ? 'open' : 'closed')
  }
  useEffect(() => {
    sidebarAutoCollapsed.current = false
    rootSingleRef.current = false
    sidebarChoicePending.current = null
    // 换作品时读回的就是作者存下的偏好，落盘权随之回到作者手里。
    sidebarOpenDriven.current = false
    setSidebarOpen(storedPanelOpen('dsh-editor.layout.sidebar-open', true))
  }, [openWorkspaceId])
  useEffect(() => {
    const sessionId = fileSession?.sessionId
    if (!sessionId) return
    let live = true
    void safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: '.',
    })).then((result) => {
      if (!live || !result.ok) return
      const single = isSingleManuscriptRoot(result.value.entries ?? [])
      rootSingleRef.current = single
      if (single && sidebarChoicePending.current !== null) {
        writeSingleSidebarChoice(openWorkspaceIdRef.current, sidebarChoicePending.current ? 'open' : 'closed')
        sidebarAutoCollapsed.current = false
      }
      sidebarChoicePending.current = null
      const next = sidebarAfterManuscriptCensus({
        open: sidebarOpenRef.current,
        autoCollapsed: sidebarAutoCollapsed.current,
        single,
        explicit: readSingleSidebarChoice(openWorkspaceIdRef.current),
      })
      sidebarAutoCollapsed.current = next.autoCollapsed
      if (next.open === sidebarOpenRef.current) return
      // 自动收起是系统判断，不落盘；按作者显式记下的单稿件选择展开则是作者的选择。
      sidebarOpenDriven.current = next.autoCollapsed
      setSidebarOpen(next.open)
    })
    return () => { live = false }
  }, [ctx, fileSession?.sessionId, treeRevision])
  useEffect(() => {
    // 同上：让位或自动收起的结果不落盘。标记由作者操作清除，不是消费式的。
    if (assistantOpenDriven.current) return
    try { globalThis.localStorage?.setItem('dsh-editor.layout.assistant-open', String(assistantOpen)) } catch { /* View preferences remain optional. */ }
  }, [assistantOpen])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.sidebar-width', String(sidebarWidth)) } catch { /* View preferences remain optional. */ }
  }, [sidebarWidth])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.assistant-width', String(assistantWidth)) } catch { /* View preferences remain optional. */ }
  }, [assistantWidth])
  useEffect(() => {
    try {
      if (pinnedPath) globalThis.localStorage?.setItem('dsh-editor.layout.pinned-path', pinnedPath)
      else globalThis.localStorage?.removeItem('dsh-editor.layout.pinned-path')
    } catch { /* View preferences remain optional. */ }
  }, [pinnedPath])
  useEffect(() => {
    try { globalThis.localStorage?.setItem('dsh-editor.layout.pinned-width', String(pinnedWidth)) } catch { /* View preferences remain optional. */ }
  }, [pinnedWidth])
  /* 侧栏/助手开关:专注模式下打开 = 退出专注并打开;窄窗下两个覆盖层互斥。 */
  const toggleSidebarChrome = () => {
    const next = focusMode ? true : !sidebarOpen
    if (focusMode) setFocusMode(false)
    claimSidebar(next)
    noteSidebarChoice(next)
    setSidebarOpen(next)
    if (next && compactChrome) yieldAssistantToWidth()
  }
  const toggleAssistantChrome = () => {
    const next = focusMode ? true : !assistantOpen
    if (focusMode) setFocusMode(false)
    claimAssistant(next)
    setAssistantOpen(next)
    if (next && compactChrome) yieldSidebarToWidth()
  }
  const revealSidebar = useCallback(() => {
    const width = Math.max(sidebarWidthRef.current, 336)
    try {
      sidebarPanelRef.current?.resize(width + 'px')
    } catch {
      /* 面板刚挂回 Group 时命令式 API 会抛 Layout not found；
         临时加宽可放弃，作者宽度不落盘。 */
    }
    if (compactChrome) yieldAssistantToWidth()
    setFocusMode(false)
    claimSidebar(true)
    noteSidebarChoice(true)
    setSidebarOpen(true)
  }, [claimSidebar, compactChrome, yieldAssistantToWidth])
  const sidebarVisible = sidebarOpen && !focusMode && !(officialPreviewOpen && compactChrome)
  const sidebarInGrid = sidebarVisible && !compactChrome
  /* 窄窗(≤760px):侧栏与助手改成覆盖层抽屉,不再整个禁用。 */
  const assistantVisible = assistantOpen && !focusMode && assistantEnabled && !(officialPreviewOpen && overlayAssistant)
  const assistantInGrid = assistantVisible && !overlayAssistant
  const pinnedVisible = pinnedPath !== null && !focusMode && !overlayAssistant
  /* 写作搭档面板始终挂载（草稿是 Chat 本地 state），关闭=折叠到 0 宽；
     窄窗 overlay 抽屉与网格共用同一实例，窗口越过断点不丢草稿。
     hooks 必须全部早于下方的首页早退分支，否则违反渲染顺序。 */
  const assistantPanelRef = useRef<PanelImperativeHandle>(null)
  useEffect(() => {
    const sync = () => {
      const plan = railPanelSync(assistantInGrid)
      const assistant = assistantPanelRef.current
      try {
        if (plan.collapseAssistant) {
          if (assistant && !assistant.isCollapsed()) assistant.collapse()
        } else if (assistant) {
          if (assistant.isCollapsed()) assistant.expand()
          else if (assistant.getSize().inPixels > 0 && Math.abs(assistant.getSize().inPixels - assistantWidth) >= 1) {
            assistant.resize(`${assistantWidth}px`)
          }
        }
      } catch {
        /* 面板刚挂回 Group、布局槽还没分配时命令式 API 会抛 Layout not found，
           由后面的 rAF 再补一次；异常不能击穿整棵树。 */
      }
      const sidebar = sidebarPanelRef.current
      try {
        if (sidebar && sidebar.getSize().inPixels > 0 && Math.abs(sidebar.getSize().inPixels - sidebarWidth) >= 1) {
          sidebar.resize(`${sidebarWidth}px`)
        }
      } catch {
        /* 同上。 */
      }
    }
    /* 侧栏/钉住栏挂上或卸下时 Group 会重算尺寸；折叠态可能被 minSize 顶开。
       面板库的 ResizeObserver 也可能先跑一遍按百分比的再平衡，把栏宽夹走，
       所以先同步一次，再补两帧，始终回到作者记下的像素宽度。 */
    sync()
    const frame = globalThis.requestAnimationFrame(() => {
      sync()
      globalThis.requestAnimationFrame(sync)
    })
    return () => globalThis.cancelAnimationFrame(frame)
  }, [assistantInGrid, sidebarInGrid, pinnedVisible, sidebarWidth, assistantWidth])

  return {
    sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth, sidebarWidthRef, sidebarPanelRef,
    assistantOpen, setAssistantOpen, assistantWidth, setAssistantWidth, assistantWidthRef, assistantPanelRef,
    pinnedPath, setPinnedPath, pinnedWidth, setPinnedWidth, pinnedWidthRef,
    focusMode, setFocusMode, compactChrome, overlayAssistant, claimSidebar, claimAssistant,
    yieldSidebarToWidth, yieldAssistantToWidth, noteSidebarChoice, toggleSidebarChrome, toggleAssistantChrome,
    revealSidebar, sidebarVisible, sidebarInGrid, assistantVisible, assistantInGrid, pinnedVisible,
  }
}
