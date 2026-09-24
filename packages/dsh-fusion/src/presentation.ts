import { isWorking, type FusionPair, type FusionTask } from './contracts.ts'

export type FusionLocale = 'zh' | 'en'
export interface FusionTaskView {
  id: string
  title: string
  status: string
  detail: string
  working: boolean
  canStop: boolean
  canPreview: boolean
  candidateLabel?: string
  /** Native child address, never a human-readable label used as a routing key. */
  executionAddress: string
}
const labels = {
  zh: { dispatching: '正在交接', working: '执行中', decision: '等待主代理决策', review: '主代理审查中', accepted: '审查通过', cancelled: '已停止', failed: '执行失败', interrupted: '执行已中断' },
  en: { dispatching: 'Handing off', working: 'Executing', decision: 'Waiting for Lead decision', review: 'Lead review', accepted: 'Review passed', cancelled: 'Stopped', failed: 'Failed', interrupted: 'Interrupted' },
} as const

/** Pure task projection. No percentages, idle-to-success inference, or provider-cost estimates. */
export function taskView(pair: FusionPair, task: FusionTask, locale: FusionLocale): FusionTaskView {
  const zh = locale === 'zh', writing = pair.profile === 'writing'
  let status: string = labels[locale][task.state]
  if (zh && writing && task.state === 'working') status = '执笔中'
  if (zh && writing && task.state === 'decision') status = '等待统筹决策'
  if (zh && writing && task.state === 'review') status = '统筹审阅中'
  let detail = task.error ?? ''
  if (task.state === 'accepted') {
    if (writing && task.target) {
      status = task.adoption === 'applied' ? (zh ? '已采用' : 'Applied')
        : task.adoption === 'conflict' ? (zh ? '原文已变化' : 'Source changed')
        : task.adoption === 'dismissed' ? (zh ? '候选已放弃' : 'Candidate dismissed')
        : (zh ? '待你采用' : 'Awaiting author adoption')
      detail = zh ? '审阅通过不等于已写入稿件。' : 'Model review does not apply changes to the manuscript.'
      if (task.adoption === 'applied') detail = zh ? '宿主已确认应用。' : 'Application confirmed by the Host.'
    } else detail = zh ? '结果已通过模型审查；文件操作以原生执行记录为准。' : 'Review passed. Native execution records remain authoritative for file changes.'
  }
  if (task.cleanup === 'pending') status = zh ? '正在停止' : 'Stopping'
  if (task.cleanup === 'failed') { status = zh ? '停止未完全完成' : 'Stop incomplete'; detail = zh ? '旧结果已失效，但资源清理需要重试。' : 'Old results are invalid, but resource cleanup needs retry.' }
  const candidate = task.candidates.at(-1)
  return { id: task.id, title: task.brief.title, status, detail, working: isWorking(task.state) || task.cleanup === 'pending',
    canStop: task.adoption !== 'applied' && (isWorking(task.state) || task.cleanup === 'failed' || task.state === 'interrupted'),
    canPreview: Boolean(candidate), ...(candidate ? { candidateLabel: zh ? `候选第 ${candidate.revision} 版` : `Candidate v${candidate.revision}` } : {}),
    executionAddress: `dsh-resource://subagentchat/session/${encodeURIComponent(pair.childSessionId)}?parent=${encodeURIComponent(pair.leadSessionId)}&mode=continuable` }
}

/** Only a structured and matching source can suppress a cancelled child's late wakeup. */
export function isOwnedChildNotice(source: unknown, childId: string): boolean {
  if (!source || typeof source !== 'object') return false
  const row = source as Record<string, unknown>
  return (row.kind === 'subagent-settled' || row.kind === 'agent-message') && row.senderSessionId === childId
}
