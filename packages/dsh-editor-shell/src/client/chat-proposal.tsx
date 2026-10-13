import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Badge, Box, Button, Card, Flex, Text } from '@radix-ui/themes'
import { WRITING_PROPOSE_TOOL_NAME, type AuthorProposal } from '../adapter.ts'
import { WORKBENCH_RPC_CHANNEL } from 'dsh-editor-workbench/contracts'
import { t, useLocale } from '../i18n/index.ts'
import {
  errorMessage,
  isStaleFailure,
  partialApplyDetails,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { ActivityDots, SuccessMark } from './ui/index.ts'
import {
  buildExpectedVersions,
  proposalBasisItems,
  proposalBasisLine,
  proposalFingerprint,
  proposalTargetBaselines,
  unwrapWorkbenchPrepared,
  CHAPTER_STATE_LABEL_KEYS,
  CHAPTER_STATE_LABEL_ORDER,
  type ProposalApplyResult,
  type ProposalFileApplyResult,
  type ProposalPrepared,
  type WorkbenchPrepareResponse,
} from '../model/chat-proposal.ts'

export function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: AuthorProposal; receiptId?: string; onApplied(path: string): void }) {
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
      if (!isWorkbenchProposal && props.receiptId) {
        const saved = await props.ctx.connection.rpc.call('/manuscript', 'proposal.receipt', {
          sessionId: props.sessionId, ...props.proposal, receiptId: props.receiptId,
        }) as RpcResult<{ receipt: { state: 'applied' | 'undone'; path: string; version: string } | null }>
        if (requestGeneration.current !== generation) return
        if (!saved.ok) { setState('expired'); setCanRecheck(true); setNote(t('chat.checkFailed')); return }
        if (saved.value.receipt) {
          const current = await props.ctx.connection.rpc.call('/manuscript', 'file.read', {
            sessionId: props.sessionId, path: saved.value.receipt.path,
          }) as RpcResult<{ version: string }>
          if (requestGeneration.current !== generation) return
          if (!current.ok) { setState('expired'); setCanRecheck(true); setNote(errorMessage(current)); return }
          if (current.value.version !== saved.value.receipt.version) {
            setState('expired'); setNote(t('chat.receiptChanged'))
            return
          }
          setState(saved.value.receipt.state)
          setNote(t(saved.value.receipt.state === 'applied' ? 'chat.applied' : 'chat.undone'))
          return
        }
      }
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
  }, [props.sessionId, props.receiptId, fingerprint])

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
          ...(props.receiptId ? { receiptId: props.receiptId } : {}),
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
        ...(props.receiptId ? { receiptId: props.receiptId, undoProposal: props.proposal } : {}),
      }) as RpcResult<{ version: string }>
      if (requestGeneration.current !== generation) return
      if (!result.ok) {
        setState('expired')
        setCanRecheck(false)
        const partial = partialApplyDetails(result)
        if (partial) {
          setNote(errorMessage(result))
          for (const path of partial.appliedPaths) props.onApplied(path)
        } else {
          setNote(isStaleFailure(result) ? t('chat.undoStale') : errorMessage(result))
        }
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
     V2 非空 basis 只展示 label/path，不拉取也不渲染来源正文或版本哈希。 */
  const renderTargets = () => {
    const items = proposalTargetBaselines(props.proposal)
    if (!items.length) return null
    return (
      <Box asChild>
        <section className="proposal-target" aria-label={t('chat.proposalTarget')}>
          <Text size="1" color="gray">
            {t('chat.proposalTarget')}
          </Text>
          <Box asChild mt="1">
            <ul>
              {items.map((item) => <li
                key={`${item.path}|${item.version}`}
                aria-label={t('chat.proposalTargetPath', { path: item.path })}>
                <Text size="1" color="gray">
                  <code className="proposal-path">
                    {item.path}
                  </code>
                </Text>
              </li>)}
            </ul>
          </Box>
        </section>
      </Box>
    );
  }
  const renderBasis = () => {
    const items = proposalBasisItems(props.proposal)
    if (!items.length) return null
    return (
      <Box asChild>
        <section className="proposal-basis" aria-label={t('chat.proposalBasis')}>
          <Text size="1" color="gray">
            {t('chat.proposalBasis')}
          </Text>
          <Box asChild mt="1">
            <ul>
              {items.map((item) => {
                const label = item.label?.trim()
                return (
                  <li
                    key={`${item.path}|${item.version}|${label ?? ''}`}
                    aria-label={proposalBasisLine(item)}>
                    <Text size="1" color="gray">
                      {label ? <Fragment>
                        <span>
                          {label}
                        </span>
                        {' · '}
                      </Fragment> : null}
                      <code className="proposal-path">
                        {item.path}
                      </code>
                    </Text>
                  </li>
                );
              })}
            </ul>
          </Box>
        </section>
      </Box>
    );
  }
  const renderKindBody = () => {
    if (props.proposal.kind === 'edit') {
      const editPrepared = prepared?.kind === 'edit' ? prepared : null
      return (
        <Flex className="proposal-diff" direction="column" gap="3">
          <Box asChild>
            <section>
              <Text size="1" color="gray">
                {t('chat.original')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {editPrepared?.before ?? props.proposal.oldText}
                </pre>
              </Box>
            </section>
          </Box>
          <Box asChild>
            <section>
              <Text size="1" color="gray">
                {t('chat.revised')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {editPrepared?.after ?? props.proposal.newText}
                </pre>
              </Box>
            </section>
          </Box>
        </Flex>
      );
    }
    if (props.proposal.kind === 'create') {
      const createPrepared = prepared?.kind === 'create' ? prepared : null
      return (
        <Fragment>
          {createPrepared && createPrepared.missingDirectories.length
            ? <Text as="p" size="1" color="gray" className="proposal-missing-dirs">
            {t('chat.missingDirs', { paths: createPrepared.missingDirectories.join('、') })}
          </Text>
            : null}
          <Box asChild>
            <section className="proposal-preview">
              <Text size="1" color="gray">
                {t('chat.newFileContent')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {props.proposal.text}
                </pre>
              </Box>
            </section>
          </Box>
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
        <Flex className="proposal-diff" direction="column" gap="3">
          <Box asChild>
            <section>
              <Text size="1" color="gray">
                {t('chat.metaBefore')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {metaPrepared?.before ?? ''}
                </pre>
              </Box>
            </section>
          </Box>
          <Box asChild>
            <section>
              <Text size="1" color="gray">
                {t('chat.metaAfter')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {metaPrepared?.after ?? fallback}
                </pre>
              </Box>
            </section>
          </Box>
        </Flex>
      );
    }
    if (props.proposal.kind === 'split') {
      const splitPrepared = prepared?.kind === 'split' ? prepared : null
      return (
        <Flex className="proposal-diff" direction="column" gap="3">
          <Box asChild>
            <section>
              <Text size="1" color="gray">
                {t('chat.splitBefore')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {splitPrepared?.before ?? ''}
                </pre>
              </Box>
            </section>
          </Box>
          <Box asChild>
            <section>
              <Text size="1" color="gray">
                {t('chat.splitAfter')}
              </Text>
              <Box asChild mt="1" overflow="auto">
                <pre>
                  {splitPrepared?.after ?? ''}
                </pre>
              </Box>
            </section>
          </Box>
          <Box asChild>
            <section className="proposal-split-summary">
              <Text size="1" color="gray">
                {t('chat.toNewFile')}
              </Text>
              <code>
                {props.proposal.newPath}
              </code>
              {splitPrepared
                ? <Text size="1" color="gray">
                {t('chat.splitChars', { head: splitPrepared.headChars, tail: splitPrepared.tailChars })}
              </Text>
                : null}
            </section>
          </Box>
        </Flex>
      );
    }
    if (props.proposal.kind === 'merge') {
      const mergePrepared = prepared?.kind === 'merge' ? prepared : null
      return (
        <Box asChild>
          <section className="proposal-merge-summary">
            <Text as="p" size="2">
              <code>
                {props.proposal.sourcePath}
              </code>
              {' → '}
              <code>
                {props.proposal.path}
              </code>
            </Text>
            {mergePrepared
              ? <Text as="p" size="2">
              {t('chat.mergeChars', { pathChars: mergePrepared.pathChars, sourceChars: mergePrepared.sourceChars })}
            </Text>
              : null}
            <Text size="1" color="gray">
              {t('chat.mergeArchiveHint')}
            </Text>
          </section>
        </Box>
      );
    }
    /* renames */
    return (
      <Box asChild>
        <section className="proposal-renames">
          <ul>
            {props.proposal.renames.map((rename) => <li key={`${rename.from}->${rename.to}`}>
              <Text size="1" color="gray">
                <code>
                  {rename.from}
                </code>
                {' → '}
                <code>
                  {rename.to}
                </code>
              </Text>
            </li>)}
          </ul>
        </section>
      </Box>
    );
  }
  /* §5 提案卡：header=操作类型+路径+摘要；中部 diff；底部按钮顺序
     主「应用修改」→ 次「放弃」→ 状态行 → 依据行。 */
  const renderBody = () => renderKindBody()

  const canRecheckNow = state === 'deferred' || (state === 'expired' && canRecheck)
  const canUndo = state === 'applied' && props.proposal.kind === 'edit' && Boolean(appliedVersion)
  const hasActions = state === 'ready' || canRecheckNow || canUndo
  const footer = <Flex asChild direction="column" gap="2" mt="3">
    <footer>
      {hasActions ? <Flex className="proposal-actions" gap="2" wrap="wrap">
        {state === 'ready' ? <Button type="button" variant="solid" onClick={() => void apply()}>
          {t('chat.applyChanges')}
        </Button> : null}
        {state === 'ready' ? <Button
          type="button"
          variant="soft"
          color="gray"
          className="proposal-dismiss"
          onClick={() => { setState('ignored'); setNote(t('chat.ignoredNoChange')) }}>
          {t('chat.discardProposal')}
        </Button> : null}
        {canRecheckNow ? <Button type="button" variant="solid" onClick={() => void check()}>
          {t('chat.recheck')}
        </Button> : null}
        {canUndo ? <Button type="button" variant="soft" color="gray" onClick={() => void undo()}>
          {t('chat.undoThis')}
        </Button> : null}
      </Flex> : null}
      <Text
        size="1"
        color={state === 'expired' ? 'red' : 'gray'}
        className="proposal-status"
        role={state === 'expired' ? 'alert' : 'status'}>
        {state === 'checking' || state === 'applying' || state === 'undoing'
          ? <ActivityDots />
          : state === 'applied' || state === 'undone'
            ? <SuccessMark />
            : null}
        {note}
      </Text>
      {renderTargets()}
      {renderBasis()}
    </footer>
  </Flex>
  const metaBlock = <Flex className="proposal-meta" align="center" gap="2" wrap="wrap" minWidth="0">
    {kindBadge ? <Badge className="proposal-kind" variant="soft" size="1">
      {kindBadge}
    </Badge> : null}
    <Text size="1" color="gray" className="proposal-path">
      {headerPathLabel}
    </Text>
  </Flex>
  const titleBlock = <Text size="2" weight="medium" className="proposal-heading">
    {props.proposal.summary}
  </Text>
  if (settled) {
    return (
      <Card className={`proposal-card ${state} proposal-card-settled`} size="2" aria-label={t('chat.fileProposal')}>
        <details>
          <summary>
            <Flex direction="column" gap="1" minWidth="0">
              {metaBlock}
              <Flex align="center" justify="between" gap="2" wrap="wrap">
                {titleBlock}
                <Text size="1" color="gray" className="proposal-status" role="status">
                  {state === 'applied' || state === 'undone' ? <SuccessMark /> : null}
                  {note}
                </Text>
              </Flex>
            </Flex>
          </summary>
          {renderBody()}
          {footer}
        </details>
      </Card>
    );
  }
  return (
    <Card className={`proposal-card ${state}`} size="2" aria-label={t('chat.fileProposal')}>
      <Flex asChild align="start" direction="column" gap="1" mb="3">
        <header>
          {metaBlock}
          {titleBlock}
        </header>
      </Flex>
      {renderBody()}
      {footer}
    </Card>
  );
}

/** author_observe 的作者确认卡。确认后由 Shell 把 observation 作为新一行追加进 authorMemory。 */
