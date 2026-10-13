import {
  railAtWidth,
  railByAuthor,
  type RailWidthState,
  type RailYieldState,
} from '../client/narrow-layout.ts'
import { clampPanelWidth } from '../client/shared.ts'
import {
  readSingleSidebarChoice,
  sidebarAfterManuscriptCensus,
  writeSingleSidebarChoice,
} from '../client/sidebar-chrome.ts'
import type { WorkspaceId } from '../dsh-compat.ts'

/*
 * 工作台布局模型（shell-rewrite-spec §0–§2）：纯状态机，不依赖 React。
 * 作者操作指作者点击或按快捷键产生的显式开关/宽度/页签，写入 localStorage；
 * 由宽度、预览或右侧栏驱动（driven）的折叠只落在内存态上。
 * use-workbench-layout.ts 负责把这里的输出接到 react-resizable-panels 的
 * 命令式 API 上（Panel 初值只用一次，之后全靠命令式同步）。
 */

export const FILES_OPEN_KEY = 'dsh-editor.layout.sidebar-open'
export const AUX_OPEN_KEY = 'dsh-editor.layout.assistant-open'
export const AUX_TAB_KEY = 'dsh-editor.layout.aux-tab'
export const FILES_WIDTH_KEY = 'dsh-editor.layout.sidebar-width'
export const AUX_WIDTH_KEY = 'dsh-editor.layout.assistant-width'

export const FILES_MIN = 200
export const FILES_MAX = 440
export const FILES_DEFAULT = 260
export const AUX_MIN = 320
export const AUX_MAX = 640
export const AUX_DEFAULT = 400
/** 展开工具类页签时的最小可见宽度；不改作者的宽度值。 */
export const AUX_REVEAL_MIN = 336

export type AuxTab = 'partner' | 'reference' | 'tools'

export type WorkbenchCrowded = { files: boolean; aux: boolean }

export type WorkbenchLayout = {
  /* 对外快照只暴露呈现需要的字段；crowded/authored 是结算内部状态。 */
  files: { open: boolean; yielded: boolean | null }
  aux: { open: boolean; yielded: boolean | null; tab: AuxTab }
  focus: boolean
}

export type LayoutStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

function auxTabFromStorage(raw: string | null): AuxTab {
  return raw === 'reference' || raw === 'tools' ? raw : 'partner'
}

/* 存储读写一律走注入的 LayoutStorage（测试与运行期同一条路径）；不可用时
   回退默认值，布局仍会工作但偏好不落盘。 */
function storedOpen(storage: LayoutStorage | undefined, key: string, fallback: boolean): boolean {
  try {
    const raw = storage?.getItem(key)
    return raw === null || raw === undefined ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

function storedWidth(storage: LayoutStorage | undefined, key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = storage?.getItem(key)
    if (raw === null || raw === undefined) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? clampPanelWidth(value, min, max) : fallback
  } catch {
    return fallback
  }
}

function railAt(rail: RailWidthState, crowded: boolean, force = false): RailWidthState {
  return railAtWidth(rail, crowded, force)
}

export class WorkbenchLayoutModel {
  private files: RailWidthState
  private aux: RailWidthState
  private tab: AuxTab
  private focus = false
  private filesWidth: number
  private auxWidth: number
  private auxRevealWidth: number | null = null
  /** 「系统替我临时展开的辅助栏」记号：closeRightbar 据此决定是否收回。 */
  private rightbarOpenedAux = false
  /** 官方预览是否真的开着；mount 时 shown:false 的初始同步不得当成一次关闭。 */
  private rightbarActive = false
  private crowded: WorkbenchCrowded = { files: false, aux: false }
  private autoCollapsed = false
  private rootSingle = false
  private pendingChoice: boolean | null = null
  private workspaceId: WorkspaceId | undefined
  private version = 0
  private cached: WorkbenchLayout | null = null
  private listeners = new Set<() => void>()

  constructor(private storage: LayoutStorage | undefined, workspaceId?: WorkspaceId) {
    this.workspaceId = workspaceId
    this.files = { open: storedOpen(storage, FILES_OPEN_KEY, true), yielded: null, crowded: false, authored: false }
    this.aux = { open: storedOpen(storage, AUX_OPEN_KEY, true), yielded: null, crowded: false, authored: false }
    this.tab = auxTabFromStorage(storage?.getItem(AUX_TAB_KEY) ?? null)
    this.filesWidth = storedWidth(storage, FILES_WIDTH_KEY, FILES_DEFAULT, FILES_MIN, FILES_MAX)
    this.auxWidth = storedWidth(storage, AUX_WIDTH_KEY, AUX_DEFAULT, AUX_MIN, AUX_MAX)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  private emit(): void {
    this.version += 1
    this.cached = null
    for (const listener of this.listeners) listener()
  }

  get snapshot(): WorkbenchLayout {
    const cached = this.cached
    if (cached) return cached
    const next: WorkbenchLayout = {
      files: { open: this.files.open, yielded: this.files.yielded },
      aux: { open: this.aux.open, yielded: this.aux.yielded, tab: this.tab },
      focus: this.focus,
    }
    this.cached = next
    return next
  }

  get filesViewWidth(): number {
    return this.filesWidth
  }

  get auxViewWidth(): number {
    return this.auxRevealWidth ?? this.auxWidth
  }

  get auxTab(): AuxTab {
    return this.tab
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value)
    } catch {
      /* storage unavailable — layout still works for the session */
    }
  }

  /* 宽度结算：唯一不写 localStorage 的开关路径；yielded 标记记账让位。 */
  setViewport(crowded: WorkbenchCrowded): void {
    this.crowded = crowded
    this.files = railAt(this.files, crowded.files)
    this.aux = railAt(this.aux, crowded.aux)
    this.emit()
  }

  /* 切换作品（含冷启动挂载）：重读作者偏好后立刻按当前宽度结算，
     让位在重读之后发生，不会把存储里的「开」重新弹回来。 */
  workspaceChanged(id: WorkspaceId | undefined): void {
    this.workspaceId = id
    this.autoCollapsed = false
    this.rootSingle = false
    this.pendingChoice = null
    this.rightbarOpenedAux = false
    this.rightbarActive = false
    this.auxRevealWidth = null
    this.files = { open: storedOpen(this.storage, FILES_OPEN_KEY, true), yielded: null, authored: false, crowded: this.crowded.files }
    this.aux = { open: storedOpen(this.storage, AUX_OPEN_KEY, true), yielded: null, authored: false, crowded: this.crowded.aux }
    this.files = railAt(this.files, this.crowded.files)
    this.aux = railAt(this.aux, this.crowded.aux)
    this.emit()
  }

  /* 稿件数量统计只驱动 sidebar 的自动收合，一律不写偏好。 */
  manuscriptCensus(single: boolean): void {
    this.rootSingle = single
    if (single && this.pendingChoice !== null) {
      writeSingleSidebarChoice(this.workspaceId, this.pendingChoice ? 'open' : 'closed')
      this.autoCollapsed = false
    }
    this.pendingChoice = null
    const next = sidebarAfterManuscriptCensus({
      open: this.files.open,
      autoCollapsed: this.autoCollapsed,
      single,
      explicit: readSingleSidebarChoice(this.workspaceId),
    })
    this.autoCollapsed = next.autoCollapsed
    if (next.open !== this.files.open) this.files = { ...this.files, open: next.open }
    this.emit()
  }

  /* 作者显式开关：claim 当前档位、写偏好、互斥让位另一个覆盖层。 */
  setFilesOpen(open: boolean): void {
    if (this.focus) this.focus = false
    this.files = railByAuthor(open, this.crowded.files)
    this.write(FILES_OPEN_KEY, String(open))
    this.noteFilesChoice(open)
    if (open && this.crowded.files) this.aux = railAt(this.aux, this.crowded.aux, true)
    this.emit()
  }

  setAuxOpen(open: boolean): void {
    if (this.focus) this.focus = false
    this.aux = railByAuthor(open, this.crowded.aux)
    this.write(AUX_OPEN_KEY, String(open))
    this.rightbarOpenedAux = false
    if (open && this.crowded.files) this.files = railAt(this.files, this.crowded.files, true)
    this.emit()
  }

  /* 只有作者手动切换页签才写 aux-tab。 */
  selectAuxTab(tab: AuxTab): void {
    this.tab = tab
    this.write(AUX_TAB_KEY, tab)
    this.emit()
  }

  setFilesWidth(width: number): void {
    this.filesWidth = clampPanelWidth(width, FILES_MIN, FILES_MAX)
    this.write(FILES_WIDTH_KEY, String(this.filesWidth))
    this.emit()
  }

  setAuxWidth(width: number): void {
    this.auxWidth = clampPanelWidth(width, AUX_MIN, AUX_MAX)
    this.auxRevealWidth = null
    this.write(AUX_WIDTH_KEY, String(this.auxWidth))
    this.emit()
  }

  enterFocus(): void {
    this.focus = true
    this.emit()
  }

  exitFocus(): void {
    this.focus = false
    this.emit()
  }

  /* Ctrl+L 或启动按钮：打开辅助栏并切到「搭档」。 */
  focusPartner(): void {
    this.tab = 'partner'
    this.setAuxOpen(true)
  }

  /* 「钉住」进入「资料」页签（作者行为，写 assistant-open）。 */
  pinReference(): void {
    this.tab = 'reference'
    this.setAuxOpen(true)
  }

  /* 席位 revealSidebar：展开「工具」页签，需要时给到最小可见宽度。 */
  revealTools(): void {
    this.tab = 'tools'
    this.auxRevealWidth = Math.max(this.auxRevealWidth ?? this.auxWidth, AUX_REVEAL_MIN)
    this.setAuxOpen(true)
  }

  /* 系统动作：打开官方 rightbar/资源预览，不写 assistant-open。 */
  openRightbarPreview(): void {
    this.rightbarActive = true
    if (!this.aux.open) {
      this.rightbarOpenedAux = true
      /* authored 保证紧随其后的宽度结算不会把系统展开立刻收回去；
         窗口换档时 authored 按档清掉，让位规则重新接管。 */
      this.aux = { open: true, yielded: null, crowded: this.crowded.aux, authored: true }
    }
    this.tab = 'reference'
    this.emit()
  }

  closeRightbarPreview(): void {
    /* 只对一次真实的预览会话收尾；初始的 shown:false 同步不是关闭事件。 */
    if (!this.rightbarActive) return
    this.rightbarActive = false
    if (this.rightbarOpenedAux) {
      this.rightbarOpenedAux = false
      this.aux = { ...this.aux, open: false }
    }
    this.emit()
  }

  private noteFilesChoice(open: boolean): void {
    this.autoCollapsed = false
    if (!this.rootSingle) {
      this.pendingChoice = open
      return
    }
    this.pendingChoice = null
    writeSingleSidebarChoice(this.workspaceId, open ? 'open' : 'closed')
  }
}
