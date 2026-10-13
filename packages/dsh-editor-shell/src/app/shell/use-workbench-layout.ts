import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { isSingleManuscriptRoot } from '../../client/sidebar-chrome.ts'
import { safeRpcCall, type ShellContext } from '../../client/shared.ts'
import type { SessionFace } from '../../dsh-compat.ts'
import { useMediaQuery } from '../../client/components.tsx'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import type { WorkspaceId } from '../../dsh-compat.ts'
import {
  WorkbenchLayoutModel,
  type AuxTab,
  type WorkbenchLayout,
} from '../../model/workbench-layout.ts'

/**
 * 工作台布局 hook：WorkbenchLayoutModel 是状态权威，本 hook 只负责
 * 视口媒体查询、作品切换、单稿件统计和 Panel 命令式同步这些接线。
 * Panel 初值只在挂载时用一次，之后全靠命令式 resize 校准（spec §0：
 * 「Panel 的 defaultSize 只在挂载时用一次，之后全靠命令式 API」）。
 */
export function useWorkbenchLayout(args: {
  ctx: ShellContext
  fileSession?: SessionFace
  workspaceId?: WorkspaceId
  workspaceReady: boolean
}) {
  const modelRef = useRef<WorkbenchLayoutModel | null>(null)
  if (!modelRef.current) {
    let storage: Storage | undefined
    try { storage = globalThis.localStorage } catch { storage = undefined }
    modelRef.current = new WorkbenchLayoutModel(storage, args.workspaceId)
  }
  const model = modelRef.current

  useSyncExternalStore(model.subscribe, model.getVersion)
  const layout = model.snapshot

  const filesCrowded = useMediaQuery('(max-width: 760px)')
  const auxCrowded = useMediaQuery('(max-width: 1040px)')
  const crowded = useMemo(() => ({ files: filesCrowded, aux: auxCrowded }), [filesCrowded, auxCrowded])
  useEffect(() => { model.setViewport(crowded) }, [model, crowded])

  const workspaceId = args.workspaceId
  useEffect(() => { model.workspaceChanged(workspaceId) }, [model, workspaceId])

  const { ctx, fileSession } = args
  useEffect(() => {
    if (!workspaceId || !fileSession) return
    let disposed = false
    ;(async () => {
      const result = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(
        () => ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId: fileSession.sessionId, path: '.' }),
      )
      if (disposed) return
      if (result.ok) model.manuscriptCensus(isSingleManuscriptRoot(result.value.entries ?? []))
    })().catch(() => {})
    return () => { disposed = true }
  }, [ctx, fileSession, model, workspaceId])

  const filesVisible = args.workspaceReady && layout.files.open && !layout.focus
  const auxVisible = args.workspaceReady && layout.aux.open && !layout.focus
  const filesInGrid = filesVisible && !filesCrowded
  const auxInGrid = auxVisible && !auxCrowded
  const filesDrawerOpen = filesVisible && filesCrowded
  const auxDrawerOpen = auxVisible && auxCrowded

  const filesPanelRef = useRef<PanelImperativeHandle | null>(null)
  const auxPanelRef = useRef<PanelImperativeHandle | null>(null)
  const filesWidthRef = useRef(model.filesViewWidth)
  const auxWidthRef = useRef(model.auxViewWidth)
  filesWidthRef.current = model.filesViewWidth
  auxWidthRef.current = model.auxViewWidth

  /* 侧栏挂上或卸下时 Group 会重算尺寸；面板库的 ResizeObserver 也可能先跑一遍
     按百分比的再平衡，把栏宽夹走，所以先同步一次，再补两帧，回到当前窗口的像素
     宽度（含临时展开）。面板刚挂回 Group、布局槽还没分配时命令式 API 会抛
     Layout not found，由后面的 rAF 再补一次；异常不能击穿整棵树。 */
  useEffect(() => {
    const sync = () => {
      for (const [panel, width] of [
        [filesPanelRef.current, filesWidthRef.current],
        [auxPanelRef.current, auxWidthRef.current],
      ] as const) {
        try {
          if (panel && panel.getSize().inPixels > 0 && Math.abs(panel.getSize().inPixels - width) >= 1) {
            panel.resize(`${width}px`)
          }
        } catch { /* Layout not found — 下一帧再补 */ }
      }
    }
    sync()
    let followup: number | undefined
    const frame = globalThis.requestAnimationFrame(() => {
      sync()
      followup = globalThis.requestAnimationFrame(sync)
    })
    return () => {
      globalThis.cancelAnimationFrame(frame)
      if (followup !== undefined) globalThis.cancelAnimationFrame(followup)
    }
  }, [filesInGrid, auxInGrid, layout.files.open, layout.aux.open, layout.aux.tab, model.auxViewWidth, model.filesViewWidth])

  return {
    layout,
    model,
    crowded,
    filesPanelRef,
    auxPanelRef,
    filesWidthRef,
    auxWidthRef,
    filesVisible,
    auxVisible,
    filesInGrid,
    auxInGrid,
    filesDrawerOpen,
    auxDrawerOpen,
    filesViewWidth: model.filesViewWidth,
    auxViewWidth: model.auxViewWidth,
    setFilesOpen: (open: boolean) => model.setFilesOpen(open),
    setAuxOpen: (open: boolean) => model.setAuxOpen(open),
    selectAuxTab: (tab: AuxTab) => model.selectAuxTab(tab),
    enterFocus: () => model.enterFocus(),
    exitFocus: () => model.exitFocus(),
    toggleFocus: () => { if (model.snapshot.focus) model.exitFocus(); else model.enterFocus() },
    focusPartner: () => model.focusPartner(),
    pinReference: () => model.pinReference(),
    revealTools: () => model.revealTools(),
    openRightbarPreview: () => model.openRightbarPreview(),
    closeRightbarPreview: () => model.closeRightbarPreview(),
    setFilesWidth: (width: number) => model.setFilesWidth(width),
    setAuxWidth: (width: number) => model.setAuxWidth(width),
  }
}

export type WorkbenchLayoutController = ReturnType<typeof useWorkbenchLayout>
