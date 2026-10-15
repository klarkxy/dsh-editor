import type { ChatRow } from '../adapter.ts'

/*
 * 会话内提案卡的共享登记表：卡片把自己的状态、元素与 apply 挂上来，
 * 线程据此渲染「N 个待处理提案」粘性条与「全部应用」批量入口。
 * 卡片状态机仍在 ProposalCard 内部，板子只做读状态与顺序调用的薄壳。
 */

export type ProposalCardStatus =
  | 'checking'
  | 'ready'
  | 'applying'
  | 'expired'
  | 'deferred'
  | 'applied'
  | 'ignored'
  | 'undoing'
  | 'undone'

/** settled 与 ProposalCard 的折叠判定一致：作者已经给出处置结论。 */
export function settledProposalStatus(status: ProposalCardStatus): boolean {
  return status === 'applied' || status === 'ignored' || status === 'deferred' || status === 'undone'
}

export type ProposalBoardEntry = {
  /** 行 id（receipt/row id），板内唯一。 */
  id: string
  /** 所属回合：transcript 中该提案行之前最近一条 user 行的序号；-1 表示回合外历史。 */
  turnKey: number
  status(): ProposalCardStatus
  element(): HTMLElement | null
  apply(): Promise<void> | void
}

export type ProposalBoard = {
  register(entry: ProposalBoardEntry): () => void
  /** 卡片状态变化时调用，订阅者（pill、全部应用）重读 status()。 */
  notify(): void
  subscribe(listener: () => void): () => void
  entries(): readonly ProposalBoardEntry[]
  version(): number
}

export function createProposalBoard(): ProposalBoard {
  const entries: ProposalBoardEntry[] = []
  const listeners = new Set<() => void>()
  let version = 0
  const emit = () => {
    version += 1
    for (const listener of listeners) listener()
  }
  return {
    register(entry) {
      entries.push(entry)
      emit()
      return () => {
        const index = entries.indexOf(entry)
        if (index < 0) return
        entries.splice(index, 1)
        emit()
      }
    },
    notify: emit,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    entries() {
      return [...entries]
    },
    version() {
      return version
    },
  }
}

/** 待处理 = 尚未结算（含正在核对/应用中的瞬时态）。 */
export function pendingProposalEntries(entries: readonly ProposalBoardEntry[]): ProposalBoardEntry[] {
  return entries.filter((entry) => !settledProposalStatus(entry.status()))
}

export type ApplyAllGroup = {
  turnKey: number
  entries: ProposalBoardEntry[]
}

/*
 * 「全部应用」的分组：同一回合 ≥2 条提案且全部核对为可安全应用才出现。
 * 取最后一个满足条件的回合——多回合并存时作者处理的是最新一批。
 */
export function applyAllGroup(entries: readonly ProposalBoardEntry[]): ApplyAllGroup | null {
  const pending = pendingProposalEntries(entries)
  const byTurn = new Map<number, ProposalBoardEntry[]>()
  for (const entry of pending) {
    const list = byTurn.get(entry.turnKey) ?? []
    list.push(entry)
    byTurn.set(entry.turnKey, list)
  }
  let group: ApplyAllGroup | null = null
  for (const [turnKey, list] of byTurn) {
    if (list.length >= 2 && list.every((entry) => entry.status() === 'ready')) group = { turnKey, entries: list }
  }
  return group
}

/*
 * 每条提案行归到它之前最近一条 user 行所在的回合（行号即 turnKey，
 * 天然按 transcript 顺序单调）；回合外历史（还没有 user 行）给 -1。
 * 「全部应用」按这个键把提案分成同一回合的批次。
 */
export function proposalTurnKeys(rows: readonly ChatRow[]): Map<string, number> {
  const keys = new Map<string, number>()
  let turn = -1
  rows.forEach((row, index) => {
    if (row.role === 'user') turn = index
    if (row.proposal) keys.set(row.id, turn)
  })
  return keys
}

export type ApplyAllResult = { applied: number; stopped: boolean }

/*
 * 顺序应用：逐条走卡片自身的 apply（同样的版本核对与回执）。
 * 已结算的跳过；ready 的应用失败就地停下；中间出现非 ready 未结算卡
 * （核对失败/过期/仍在核对）同样停下——按钮亮起时它们曾是安全的，
 * 状态反转意味着出现了冲突，越过它继续写后面的提案不安全。剩余提案
 * 保持待处理，失败卡留在它自己的冲突/过期状态上。
 */
export async function applyReadyProposals(entries: readonly ProposalBoardEntry[]): Promise<ApplyAllResult> {
  let applied = 0
  for (const entry of entries) {
    const status = entry.status()
    if (settledProposalStatus(status)) continue
    if (status !== 'ready') return { applied, stopped: true }
    await entry.apply()
    if (entry.status() !== 'applied') return { applied, stopped: true }
    applied += 1
  }
  return { applied, stopped: false }
}
