import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { WRITING_PROPOSE_TOOL_NAME, type AuthorProposal } from '../adapter.ts'
import { WORKBENCH_RPC_CHANNEL } from 'dsh-editor-workbench/contracts'
import { t, useLocale, type MessageKey } from '../i18n/index.ts'
import {
  errorMessage,
  isStaleFailure,
  partialApplyDetails,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { ActivityDots, SuccessMark } from './ui/index.ts'

type WorkbenchProposalPrepared =
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
type ProposalPrepared =
  | { kind: 'edit'; version: string; before: string; after: string }
  | WorkbenchProposalPrepared

/** create / 章纲 / 章末小结 / edit 的单文件回执。 */
export type ProposalFileApplyResult = { path: string; version: string; operation?: 'create' | 'edit' }
type ProposalApplyResult =
  | ProposalFileApplyResult
  | { applied: string[]; failed?: { from: string; reason: string } }

/* 章末小结可读预览的字段顺序与标签（与 workbench 的字段预览一致）。 */
const CHAPTER_STATE_LABEL_ORDER = ['now', 'where', 'knows', 'ended', 'open'] as const
const CHAPTER_STATE_LABEL_KEYS: Record<(typeof CHAPTER_STATE_LABEL_ORDER)[number], MessageKey> = {
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

/** 优先 label，path/version 始终写入可读行；不包含来源正文。 */
export function proposalBasisLine(item: ProposalBasisRef): string {
  const label = item.label?.trim()
  return label
    ? t('chat.proposalBasisNamed', { label, path: item.path, version: item.version })
    : t('chat.proposalBasisPath', { path: item.path, version: item.version })
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

export function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: AuthorProposal; onApplied(path: string): void }) {
  const [prepared, setPrepared] = useState<ProposalPrepared | null>(null)
  const [appliedVersion, setAppliedVersion] = useState('')
  const [undoText, setUndoText] = useState('')
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'deferred' | 'ignored' | 'undoing' | 'undone' | 'expired'>('checking')
  /* 可恢复失败（传输中断、一般核对/应用失败、部分写入后的谨慎回读）允许重新核对，不需要新的模型请求；
     stale（含章纲/章末小结 sourceVersion 过期）必须重新生成提案，不提供重新核对。 */
  const [canRecheck, setCanRecheck] = useState(false)
  const [note, setNote] = useState(t('chat.checkingFiles'))
  const requestGeneration = useRef(0)

  /* edit 留在 /manuscript；create、章纲/章末小结与 split/merge/renames 一起走 workbench 通道。 */
  const isWorkbenchProposal = props.proposal.kind !== 'edit'

  const check = async () => {
    const generation = ++requestGeneration.current
    setAppliedVersion('')
    setUndoText('')
    setPrepared(null)
    setCanRecheck(false)
    setState('checking'); setNote(t('chat.checkingFiles'))
    /* workbench 通道的 prepare 传嵌套 proposal，响应按 kind 包裹；edit 仍走 /manuscript 平铺字段。 */
    const channel = isWorkbenchProposal ? WORKBENCH_RPC_CHANNEL : '/manuscript'
    let raw: unknown
    try {
      raw = isWorkbenchProposal
        ? await props.ctx.connection.rpc.call(channel, 'proposal.prepare', {
          sessionId: props.sessionId,
          proposal: props.proposal,
        })
        : await props.ctx.connection.rpc.call(channel, 'proposal.prepare', {
          sessionId: props.sessionId,
          ...props.proposal,
        })
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired'); setCanRecheck(true); setNote(t('chat.checkFailed'))
      return
    }
    if (requestGeneration.current !== generation) return
    const result = raw as RpcResult<ProposalPrepared | WorkbenchPrepareResponse>
    if (!result.ok) {
      /* stale：文件/版本已变化（章纲与章末小结即 sourceVersion 过期），要求重新生成而不是反复核对。 */
      const stale = isStaleFailure(result)
      setState('expired'); setCanRecheck(!stale)
      /* 非 stale 的失败给出可操作原因（details.reason：目录缺失/权限/重名等）。 */
      setNote(stale ? t('chat.filesChangedNoWrite') : errorMessage(result))
      return
    }
    const value = isWorkbenchProposal
      ? unwrapWorkbenchPrepared(props.proposal, result.value)
      : result.value as ProposalPrepared
    if (!value) { setState('expired'); setCanRecheck(true); setNote(t('chat.checkFailed')); return }
    setPrepared(value); setState('ready'); setNote(t('chat.safeToApply'))
  }

  /* 指纹含 V2 生成基线与有序依据条目；变更会重跑 prepare。 */
  /* 绝不把当前 file.read 写回目标生成基线。 */
  const fingerprint = useMemo(() => proposalFingerprint(props.proposal), [props.proposal])

  useEffect(() => {
    void check()
    return () => { requestGeneration.current += 1 }
  }, [props.sessionId, fingerprint])

  const apply = async () => {
    if (!prepared) return
    const generation = ++requestGeneration.current
    setState('applying'); setNote(t('chat.applying'))
    /* 运输层异常也必须落地到终态，否则会永远卡在 applying。 */
    try {
      let beforeApplyText = ''
      /* edit 路径在应用前再读一次文件,把"撤回到原内容"所需的快照存起来;其它 kind 没有撤销按钮。 */
      if (props.proposal.kind === 'edit' && prepared.kind === 'edit') {
        const read = await props.ctx.connection.rpc.call('/manuscript', 'file.read', {
          sessionId: props.sessionId,
          path: props.proposal.path,
        }) as RpcResult<{ text: string; version: string }>
        if (requestGeneration.current !== generation) return
        if (!read.ok || read.value.version !== prepared.version) {
          setState('expired'); setCanRecheck(false); setNote(t('chat.filesChangedNoWrite'))
          return
        }
        beforeApplyText = read.value.text
      }
      /* edit 走 /manuscript 的 proposal.apply,带 expectedVersion;create/章纲/章末小结与 split/merge/renames 走 workbench,带 expectedVersions。 */
      let result: RpcResult<ProposalApplyResult>
      if (props.proposal.kind === 'edit') {
        const expectedVersion = prepared.kind === 'edit' ? prepared.version : ''
        result = await props.ctx.connection.rpc.call('/manuscript', 'proposal.apply', {
          sessionId: props.sessionId,
          ...props.proposal,
          expectedVersion,
        }) as RpcResult<ProposalApplyResult>
      } else {
        const expectedVersions = buildExpectedVersions(props.proposal, prepared) ?? {}
        result = await props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'proposal.apply', {
          sessionId: props.sessionId,
          proposal: props.proposal,
          expectedVersions,
        }) as RpcResult<ProposalApplyResult>
      }
      if (requestGeneration.current !== generation) return
      if (!result.ok) {
        /* Host 用 details.partial 报告"写了一半"：刷新已变路径、展示备份位置，
           并停在 expired——既不伪装成功，也不自动重试；只允许用户手动重新核对（谨慎回读）。 */
        const partial = partialApplyDetails(result)
        if (partial) {
          setState('expired'); setCanRecheck(true)
          const wrote = partial.appliedPaths.length ? t('chat.partialPaths', { paths: partial.appliedPaths.join('、') }) : t('chat.partialTouched')
          const backup = partial.recoveryPath ? t('chat.partialBackup', { path: partial.recoveryPath }) : ''
          const snapshot = partial.safetySnapshotId ? t('chat.partialSnapshot', { id: partial.safetySnapshotId }) : ''
          setNote(t('chat.applyPartial', { wrote, backup, snapshot }))
          for (const appliedPath of partial.appliedPaths) props.onApplied(appliedPath)
          return
        }
        /* stale（含章纲/章末小结 sourceVersion 过期）：提案必须重新生成，前端绝不改写 sourceVersion 蒙混重试。
           其它失败用 details.reason 的可操作消息（目录缺失/权限/重名等）；普通 edit/create 失败后仍可重新核对现状。 */
        const stale = isStaleFailure(result)
        setState('expired'); setCanRecheck(!stale)
        setNote(stale ? t('chat.filesChangedNoWrite') : errorMessage(result))
        return
      }
      /* /manuscript 的 edit 与 workbench 的 create/章纲/章末小结都回单文件回执 {path, version, operation}。 */
      if (props.proposal.kind === 'edit' || props.proposal.kind === 'create' || props.proposal.kind === 'chapter_plan' || props.proposal.kind === 'chapter_summary') {
        const applyValue = result.value as ProposalFileApplyResult
        if (props.proposal.kind === 'edit') {
          setAppliedVersion(applyValue.version)
          setUndoText(beforeApplyText)
        }
        setState('applied'); setNote(t('chat.applied'))
        props.onApplied(applyValue.path)
        return
      }
      const applyValue = result.value as Extract<ProposalApplyResult, { applied: string[] }>
      const applied = applyValue.applied
      if (props.proposal.kind === 'split') {
        setState('applied'); setNote(t('chat.splitApplied'))
      } else if (props.proposal.kind === 'merge') {
        setState('applied'); setNote(t('chat.mergeApplied'))
      } else {
        const failed = applyValue.failed
        const ok = applied.length
        const total = props.proposal.renames.length
        const tail = failed ? t('chat.renameFailedItem', { from: failed.from, reason: failed.reason }) : ''
        setState('applied'); setNote(ok === total ? t('chat.renamedOk', { ok }) : t('chat.renamedPartial', { ok, total, tail }))
      }
      /* 通知树刷新:按 applied 顺序逐个回调,让 onApplied 自然处理导航与展开。 */
      for (const path of applied) props.onApplied(path)
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired'); setCanRecheck(true)
      setNote(t('chat.applyFailed'))
    }
  }

  const undo = async () => {
    if (props.proposal.kind !== 'edit' || !appliedVersion || !undoText) return
    const generation = ++requestGeneration.current
    setState('undoing'); setNote(t('chat.undoing'))
    try {
      const result = await props.ctx.connection.rpc.call('/manuscript', 'file.write', {
        sessionId: props.sessionId,
        path: props.proposal.path,
        text: undoText,
        version: appliedVersion,
      }) as RpcResult<{ version: string }>
      if (requestGeneration.current !== generation) return
      if (!result.ok) {
        setState('expired')
        setNote(t('chat.undoStale'))
        return
      }
      setAppliedVersion(result.value.version)
      setState('undone'); setNote(t('chat.undone'))
      props.onApplied(props.proposal.path)
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired')
      setNote(t('chat.undoFailed'))
    }
  }

  /* 头部右侧的标识:renames 展示"N 个文件",其它仍展示 path(已经在 kind 上 narrow 过)。 */
  const settled = state === 'applied' || state === 'ignored' || state === 'deferred' || state === 'undone'
  const headerPathLabel = props.proposal.kind === 'renames'
    ? t('chat.fileCount', { count: props.proposal.renames.length })
    : props.proposal.path

  /* 类型徽标:大纲/下的 create/edit 是作品大纲提案;其它 create 标明新文件;章纲与章末小结按类型标明。 */
  const kindBadge = props.proposal.kind === 'chapter_plan' ? t('chat.chapterPlanBadge')
    : props.proposal.kind === 'chapter_summary' ? t('chat.chapterSummaryBadge')
      : (props.proposal.kind === 'create' || props.proposal.kind === 'edit') && props.proposal.path.startsWith('大纲/')
        ? t('chat.outlineProposal')
        : props.proposal.kind === 'create' ? t('chat.createBadge')
          : ''

  /* 按 kind 决定主区域内容。edit 复用 proposal-diff 块;create 单 pre 并在可应用时列出将自动创建的目录;
     章纲/章末小结展示可读的字段前后对照;split 同 edit 但 before/after 来自 prepared;
     merge 展示两个文件的字符数与归档说明;renames 用 ul/li 列出 from→to。
     V2 非空 basis 只展示 label/path/version，不拉取也不渲染来源正文。 */
  const renderTargets = () => {
    const items = proposalTargetBaselines(props.proposal)
    if (!items.length) return null
    return (
      <section className="proposal-target" aria-label={t('chat.proposalTarget')}>
        <small>
          {t('chat.proposalTarget')}
        </small>
        <ul>
          {items.map((item) => <li
            key={`${item.path}|${item.version}`}
            aria-label={t('chat.proposalTargetPath', { path: item.path, version: item.version })}>
            <code className="proposal-path">
              {item.path}
            </code>
            {' · '}
            <code>
              {item.version}
            </code>
          </li>)}
        </ul>
      </section>
    );
  }
  const renderBasis = () => {
    const items = proposalBasisItems(props.proposal)
    if (!items.length) return null
    return (
      <section className="proposal-basis" aria-label={t('chat.proposalBasis')}>
        <small>
          {t('chat.proposalBasis')}
        </small>
        <ul>
          {items.map((item) => {
            const label = item.label?.trim()
            return (
              <li
                key={`${item.path}|${item.version}|${label ?? ''}`}
                aria-label={proposalBasisLine(item)}>
                {label ? <Fragment>
                  <span>
                    {label}
                  </span>
                  {' · '}
                </Fragment> : null}
                <code className="proposal-path">
                  {item.path}
                </code>
                {' · '}
                <code>
                  {item.version}
                </code>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  const renderKindBody = () => {
    if (props.proposal.kind === 'edit') {
      const editPrepared = prepared?.kind === 'edit' ? prepared : null
      return (
        <div className="proposal-diff">
          <section>
            <small>
              {t('chat.original')}
            </small>
            <pre>
              {editPrepared?.before ?? props.proposal.oldText}
            </pre>
          </section>
          <section>
            <small>
              {t('chat.revised')}
            </small>
            <pre>
              {editPrepared?.after ?? props.proposal.newText}
            </pre>
          </section>
        </div>
      );
    }
    if (props.proposal.kind === 'create') {
      const createPrepared = prepared?.kind === 'create' ? prepared : null
      return (
        <Fragment>
          {createPrepared && createPrepared.missingDirectories.length
            ? <p className="proposal-missing-dirs">
            {t('chat.missingDirs', { paths: createPrepared.missingDirectories.join('、') })}
          </p>
            : null}
          <section className="proposal-preview">
            <small>
              {t('chat.newFileContent')}
            </small>
            <pre>
              {props.proposal.text}
            </pre>
          </section>
        </Fragment>
      );
    }
    if (props.proposal.kind === 'chapter_plan' || props.proposal.kind === 'chapter_summary') {
      /* 后端 prepare 返回的是可读的字段前后对照（不是 YAML/全文）；核对前先用提案自身内容兜底展示。 */
      const proposal = props.proposal
      const metaPrepared = prepared && (prepared.kind === 'chapter_plan' || prepared.kind === 'chapter_summary') ? prepared : null
      const fallback = proposal.kind === 'chapter_plan'
        ? proposal.beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n')
        : CHAPTER_STATE_LABEL_ORDER.filter((key) => proposal.state[key]?.trim())
            .map((key) => `${t(CHAPTER_STATE_LABEL_KEYS[key])}：${proposal.state[key]}`).join('\n')
      return (
        <div className="proposal-diff">
          <section>
            <small>
              {t('chat.metaBefore')}
            </small>
            <pre>
              {metaPrepared?.before ?? ''}
            </pre>
          </section>
          <section>
            <small>
              {t('chat.metaAfter')}
            </small>
            <pre>
              {metaPrepared?.after ?? fallback}
            </pre>
          </section>
        </div>
      );
    }
    if (props.proposal.kind === 'split') {
      const splitPrepared = prepared?.kind === 'split' ? prepared : null
      return (
        <div className="proposal-diff">
          <section>
            <small>
              {t('chat.splitBefore')}
            </small>
            <pre>
              {splitPrepared?.before ?? ''}
            </pre>
          </section>
          <section>
            <small>
              {t('chat.splitAfter')}
            </small>
            <pre>
              {splitPrepared?.after ?? ''}
            </pre>
          </section>
          <section className="proposal-split-summary">
            <small>
              {t('chat.toNewFile')}
            </small>
            <code>
              {props.proposal.newPath}
            </code>
            {splitPrepared
              ? <small>
              {t('chat.splitChars', { head: splitPrepared.headChars, tail: splitPrepared.tailChars })}
            </small>
              : null}
          </section>
        </div>
      );
    }
    if (props.proposal.kind === 'merge') {
      const mergePrepared = prepared?.kind === 'merge' ? prepared : null
      return (
        <section className="proposal-merge-summary">
          <p>
            <code>
              {props.proposal.sourcePath}
            </code>
            {' → '}
            <code>
              {props.proposal.path}
            </code>
          </p>
          {mergePrepared
            ? <p>
            {t('chat.mergeChars', { pathChars: mergePrepared.pathChars, sourceChars: mergePrepared.sourceChars })}
          </p>
            : null}
          <small>
            {t('chat.mergeArchiveHint')}
          </small>
        </section>
      );
    }
    /* renames */
    return (
      <section className="proposal-renames">
        <ul>
          {props.proposal.renames.map((rename) => <li key={`${rename.from}->${rename.to}`}>
            <code>
              {rename.from}
            </code>
            {' → '}
            <code>
              {rename.to}
            </code>
          </li>)}
        </ul>
      </section>
    );
  }
  const renderBody = () => {
    const targets = renderTargets()
    const basis = renderBasis()
    if (!targets && !basis) return renderKindBody()
    return (
      <Fragment>
        {targets}
        {basis}
        {renderKindBody()}
      </Fragment>
    );
  }

  const canRecheckNow = state === 'deferred' || (state === 'expired' && canRecheck)
  const canUndo = state === 'applied' && props.proposal.kind === 'edit'
  const hasActions = state === 'ready' || canRecheckNow || canUndo
  const footer = <footer>
    <span
      className="proposal-status"
      role={state === 'expired' ? 'alert' : 'status'}>
      {state === 'checking' || state === 'applying' || state === 'undoing'
        ? <ActivityDots />
        : state === 'applied' || state === 'undone'
          ? <SuccessMark />
          : null}
      {note}
    </span>
    {hasActions ? <div className="proposal-actions">
      {state === 'ready' ? <button type="button" className="primary-action" onClick={() => void apply()}>
        {t('common.apply')}
      </button> : null}
      {state === 'ready' ? <button
        type="button"
        onClick={() => { setState('deferred'); setNote(t('chat.deferred')) }}>
        {t('chat.defer')}
      </button> : null}
      {state === 'ready' ? <button
        type="button"
        className="proposal-dismiss"
        onClick={() => { setState('ignored'); setNote(t('chat.ignoredNoChange')) }}>
        {t('common.ignore')}
      </button> : null}
      {canRecheckNow ? <button type="button" className="primary-action" onClick={() => void check()}>
        {t('chat.recheck')}
      </button> : null}
      {canUndo ? <button type="button" onClick={() => void undo()}>
        {t('chat.undoThis')}
      </button> : null}
    </div> : null}
  </footer>
  const titleBlock = <strong className="proposal-heading">
    {props.proposal.summary}
  </strong>
  const metaBlock = <div className="proposal-meta">
    {kindBadge ? <small className="proposal-kind">
      {kindBadge}
    </small> : null}
    <code className="proposal-path">
      {headerPathLabel}
    </code>
  </div>
  if (settled) {
    return (
      <details
        className={`proposal-card ${state} proposal-card-settled`}
        aria-label={t('chat.fileProposal')}>
        <summary>
          {titleBlock}
          {metaBlock}
          <span className="proposal-status" role="status">
            {state === 'applied' || state === 'undone' ? <SuccessMark /> : null}
            {note}
          </span>
        </summary>
        {renderBody()}
        {footer}
      </details>
    );
  }
  return (
    <article className={`proposal-card ${state}`} aria-label={t('chat.fileProposal')}>
      <header>
        {titleBlock}
        {metaBlock}
      </header>
      {renderBody()}
      {footer}
    </article>
  );
}

/** author_observe 的作者确认卡。确认后由 Shell 把 observation 作为新一行追加进 authorMemory。 */
