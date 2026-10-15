import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'
import { Button } from '../ui/index.ts'
import { t } from '../i18n/index.ts'
import {
  applyAllGroup,
  applyReadyProposals,
  pendingProposalEntries,
  type ApplyAllGroup,
  type ProposalBoard,
  type ProposalBoardEntry,
} from '../model/proposal-board.ts'

/*
 * 会话提案板的渲染侧薄壳：板子只挂 status/element/apply 回调，
 * 这里订阅 notify 版本号，把待处理列表、回合分组与批量入口
 * 通过 context 分发给粘性条与每张提案行，ChatHistory 本体保持无 hooks。
 */
export type ProposalBoardDerived = {
  board: ProposalBoard
  turnKeys: ReadonlyMap<string, number>
  pending: ProposalBoardEntry[]
  group: ApplyAllGroup | null
  /* 同回合全部核对安全时才有值；busy 期间重入忽略。 */
  applyAll: { count: number; busy: boolean; run(): void } | null
}

export const ProposalBoardContext = createContext<ProposalBoardDerived | null>(null)

export function ProposalBoardScope(props: {
  board: ProposalBoard
  turnKeys: ReadonlyMap<string, number>
  children?: ReactNode
}) {
  const { board } = props
  const version = useSyncExternalStore(board.subscribe, board.version, board.version)
  const entries = useMemo(() => board.entries(), [board, version])
  const pending = useMemo(() => pendingProposalEntries(entries), [entries])
  const group = useMemo(() => applyAllGroup(entries), [entries])
  const [busy, setBusy] = useState(false)
  const run = useCallback(() => {
    if (!group || busy) return
    setBusy(true)
    void applyReadyProposals(group.entries).finally(() => setBusy(false))
  }, [group, busy])
  const derived = useMemo<ProposalBoardDerived>(() => ({
    board,
    turnKeys: props.turnKeys,
    pending,
    group,
    applyAll: group ? { count: group.entries.length, busy, run } : null,
  }), [board, props.turnKeys, pending, group, busy, run])
  return <ProposalBoardContext.Provider value={derived}>{props.children}</ProposalBoardContext.Provider>
}

/* 待处理提案粘性条：只要有待处理卡在视口外就钉在顶栏；
   点击滚到第一张，旁边在同回合全部核对安全时给「全部应用」。 */
export function ChatProposalPill(props: { historyRef: RefObject<HTMLElement | null> }) {
  const derived = useContext(ProposalBoardContext)
  const pending = derived?.pending ?? []
  const applyAll = derived?.applyAll ?? null
  const [offscreen, setOffscreen] = useState(0)
  const measure = useCallback(() => {
    const scroller = props.historyRef.current
    if (!scroller) { setOffscreen(0); return }
    const viewport = scroller.getBoundingClientRect()
    let count = 0
    for (const entry of pending) {
      const el = entry.element()
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.bottom < viewport.top || rect.top > viewport.bottom) count += 1
    }
    setOffscreen(count)
  }, [props.historyRef, pending])
  useLayoutEffect(() => { measure() }, [measure])
  useEffect(() => {
    const scroller = props.historyRef.current
    if (!scroller) return
    scroller.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [props.historyRef, measure])
  if (!derived || offscreen === 0) return null
  const scrollToFirst = () => {
    const first = pending.map((entry) => entry.element()).find((el): el is HTMLElement => el != null)
    first?.scrollIntoView({ block: 'start' })
  }
  return (
    <div className="chat-proposal-pill">
      <Button type="button" variant="secondary" size="sm" onClick={scrollToFirst}>
        {t('chat.pendingProposals', { count: pending.length })}
      </Button>
      {applyAll ? <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={applyAll.busy}
        onClick={applyAll.run}>
        {t('chat.applyAll', { count: applyAll.count })}
      </Button> : null}
    </div>
  )
}

/* 给提案行提供 board/turnKey/applyAll 三个派生值；context 更新会穿透
   ChatRowView 的 memo，已结算分组或登记变化即时反映到按钮。 */
export function useProposalRowBoard(rowId: string) {
  const derived = useContext(ProposalBoardContext)
  if (!derived) return { board: undefined, turnKey: undefined, applyAll: undefined }
  return {
    board: derived.board,
    turnKey: derived.turnKeys.get(rowId),
    applyAll: derived.applyAll && derived.group?.entries[0]?.id === rowId ? derived.applyAll : undefined,
  }
}
