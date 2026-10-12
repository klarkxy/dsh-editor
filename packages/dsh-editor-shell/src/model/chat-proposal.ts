import { type AuthorProposal } from '../adapter.ts'
import { t, type MessageKey } from '../i18n/index.ts'

export type WorkbenchProposalPrepared =
  | { kind: 'create'; applicable: true; version: string; missingDirectories: string[] }
  | { kind: 'chapter_plan'; version: string; before: string; after: string }
  | { kind: 'chapter_summary'; version: string; before: string; after: string }
  | { kind: 'split'; version: string; before: string; after: string; headChars: number; tailChars: number }
  | { kind: 'merge'; versions: { path: string; sourcePath: string }; pathChars: number; sourceChars: number }
  | { kind: 'renames'; versions: Record<string, string>; entries: Array<{ from: string; to: string }> }

export type WorkbenchPrepareResponse = {
  create?: Extract<WorkbenchProposalPrepared, { kind: 'create' }>
  chapterMeta?: Extract<WorkbenchProposalPrepared, { kind: 'chapter_plan' | 'chapter_summary' }>
  split?: Extract<WorkbenchProposalPrepared, { kind: 'split' }>
  merge?: Extract<WorkbenchProposalPrepared, { kind: 'merge' }>
  renames?: Extract<WorkbenchProposalPrepared, { kind: 'renames' }>
}

/** 按 kind 拆 workbench prepare 的外层包裹；kind 不匹配时返回 undefined（调用方按核对失败处理）。 */
export function unwrapWorkbenchPrepared(proposal: AuthorProposal, value: unknown): WorkbenchProposalPrepared | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const wrapped = value as WorkbenchPrepareResponse
  if (proposal.kind === 'create') return wrapped.create
  if (proposal.kind === 'chapter_plan' || proposal.kind === 'chapter_summary') {
    const plan = wrapped.chapterMeta
    return plan && plan.kind === proposal.kind ? plan : undefined
  }
  if (proposal.kind === 'split') return wrapped.split
  if (proposal.kind === 'merge') return wrapped.merge
  if (proposal.kind === 'renames') return wrapped.renames
  return undefined
}

/** 提案 prepare 之后保存下来的所有状态，kind 一一对应。edit 保留 /manuscript 旧字段。 */
export type ProposalPrepared =
  | { kind: 'edit'; version: string; before: string; after: string }
  | WorkbenchProposalPrepared

/** create / 章纲 / 章末小结 / edit 的单文件回执。 */
export type ProposalFileApplyResult = { path: string; version: string; operation?: 'create' | 'edit' }
export type ProposalApplyResult =
  | ProposalFileApplyResult
  | { applied: string[]; failed?: { from: string; reason: string } }

/* 章末小结可读预览的字段顺序与标签（与 workbench 的字段预览一致）。 */
export const CHAPTER_STATE_LABEL_ORDER = ['now', 'where', 'knows', 'ended', 'open'] as const
export const CHAPTER_STATE_LABEL_KEYS: Record<(typeof CHAPTER_STATE_LABEL_ORDER)[number], MessageKey> = {
  now: 'chapterMeta.stateNow',
  where: 'chapterMeta.stateWhere',
  knows: 'chapterMeta.stateKnows',
  ended: 'chapterMeta.stateEnded',
  open: 'chapterMeta.stateOpen',
}

export type ProposalBasisRef = { path: string; version: string; label?: string }
export type ProposalTargetBaseline = { path: string; version: string }

/** V2 非空 basis 才进入确认卡；legacy V1 与空数组都不展示。 */
export function proposalBasisItems(proposal: AuthorProposal): readonly ProposalBasisRef[] {
  if (proposal.version !== 2 || !proposal.basis?.length) return []
  return proposal.basis
}

/** V2 目标生成基线，与可选 basis[] 分开。create 与 V1 都不展示。 */
export function proposalTargetBaselines(proposal: AuthorProposal): readonly ProposalTargetBaseline[] {
  if (proposal.version !== 2) return []
  if (proposal.kind === 'edit' || proposal.kind === 'split') return [{ path: proposal.path, version: proposal.targetVersion }]
  if (proposal.kind === 'merge') {
    return [
      { path: proposal.path, version: proposal.targetVersion },
      { path: proposal.sourcePath, version: proposal.sourceVersion },
    ]
  }
  if (proposal.kind === 'renames') return proposal.renames.map((rename) => ({ path: rename.from, version: rename.version }))
  return []
}

/** 优先 label，再写 path；版本只用于核对，不给作者看。 */
export function proposalBasisLine(item: ProposalBasisRef): string {
  const label = item.label?.trim()
  return label
    ? t('chat.proposalBasisNamed', { label, path: item.path })
    : t('chat.proposalBasisPath', { path: item.path })
}

/** 把提案压缩成字符串，作为 prepare 的 useEffect 依赖。V2 生成基线与有序 basis 分别纳入。 */
export function proposalFingerprint(proposal: AuthorProposal): string {
  const p = proposal
  const head = `${p.kind}|${p.summary}`
  const core = p.kind === 'edit' ? `${head}|${p.path}|${p.oldText}|${p.newText}`
    : p.kind === 'create' ? `${head}|${p.path}|${p.text}`
    : p.kind === 'chapter_plan' ? `${head}|${p.path}|${p.sourceVersion}|${p.beats.join('\n')}`
    : p.kind === 'chapter_summary' ? `${head}|${p.path}|${p.sourceVersion}|${JSON.stringify(p.state)}`
    : p.kind === 'split' ? `${head}|${p.path}|${p.anchor}|${p.newPath}`
    : p.kind === 'merge' ? `${head}|${p.path}|${p.sourcePath}`
      : `${head}|${p.renames.map((rename) => `${rename.from}->${rename.to}`).join(',')}`
  const targets = proposalTargetBaselines(p)
  const withTargets = targets.length
    ? `${core}|${targets.map((item) => `target|${item.path}|${item.version}`).join(';')}`
    : core
  const items = proposalBasisItems(p)
  if (!items.length) return withTargets
  return `${withTargets}|${items.map((item) => `${item.path}|${item.version}|${item.label ?? ''}`).join(';')}`
}

/** 从 prepare 响应里抽取 expectedVersions:apply 阶段原子地校验所有参与文件的版本。key 一律是真实文件路径（workbench 端按路径查找）。 */
export function buildExpectedVersions(proposal: AuthorProposal, prepared: ProposalPrepared): Record<string, string> | undefined {
  if (proposal.kind === 'split' && prepared.kind === 'split') return { [proposal.path]: prepared.version }
  if (proposal.kind === 'merge' && prepared.kind === 'merge') return { [proposal.path]: prepared.versions.path, [proposal.sourcePath]: prepared.versions.sourcePath }
  if (proposal.kind === 'renames' && prepared.kind === 'renames') return { ...prepared.versions }
  /* create 与章纲/章末小结按 prepare 观察到的版本校验目标文件；create 的 '' 表示目标尚不存在，照原样传递。 */
  if (proposal.kind === 'create' && prepared.kind === 'create') return { [proposal.path]: prepared.version }
  if ((proposal.kind === 'chapter_plan' || proposal.kind === 'chapter_summary') && prepared.kind === proposal.kind) return { [proposal.path]: prepared.version }
  return undefined
}
