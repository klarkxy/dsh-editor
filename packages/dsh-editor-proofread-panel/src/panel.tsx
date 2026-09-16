import React, { Fragment, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { WORKBENCH_RPC_CHANNEL, type ProofreadScanResponse } from 'dsh-editor-workbench/contracts'
import type { ShellProposalCardProps, ShellToolSeatContext } from 'dsh-editor-seats'
import {
  SENSITIVE_ALLOW_PATH,
  appendIgnoreLine,
  batchPunctuationEdit,
  canProposeProofreadPath,
  documentPunctuationFindings,
  excerptParts,
  filterProofreadFindings,
  formatPerThousand,
  groupFindingsByFile,
  isStaleFinding,
  kindCounts,
  proofreadKindLabel,
  proofreadSkippedText,
  quotedTerm,
  singleFindingEdit,
  toggleProofreadKind,
  type ProofreadEditDraft,
  type ProofreadFilter,
  type ProofreadFinding,
  type ProofreadKind,
  type ProofreadScope,
  PROOFREAD_KIND_CHIP_ORDER,
  allProofreadKinds,
} from './proofread-view.ts'
import { errorMessage, LatestRequestGate, safeRpcCall } from './rpc.ts'
import { setProofreadLocale, t } from './messages.ts'
import { consumeProofreadRequest, pendingProofreadRequest, subscribeProofreadRequest, type ProofreadRequest } from './requests.ts'

export type RpcCaller = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export type ProofreadSeatProps = ShellToolSeatContext & { rpc: RpcCaller }

/* 活动暗示:三点呼吸(pulse-dots)与骨架行(fluid-skeleton),参数改写自
   Amicro(MIT License, Copyright (c) 2026 Syed Subhan Uddin);装饰 aria-hidden,
   关键帧在 styles.ts,reduced-motion 停循环后保留静态可读态。 */
const activityDots = () => <span className="panel-activity-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>
const skeletonRows = (widths: readonly string[]) => <span className="panel-skeleton" aria-hidden="true">
  {widths.map((width, index) => <i key={index} style={{ width }} />)}
</span>

function toProposalMarker(draft: ProofreadEditDraft): ShellProposalCardProps['proposal'] {
  return {
    marker: 'dsh-editor.proposal',
    version: 1,
    kind: 'edit',
    path: draft.path,
    oldText: draft.oldText,
    newText: draft.newText,
    summary: draft.summary,
  }
}

function ProofreadPanel(props: ProofreadSeatProps & { request?: ProofreadRequest | null; onClose(): void }) {
  setProofreadLocale(props.locale)
  const [scope, setScope] = useState<ProofreadScope>('document')
  const [kinds, setKinds] = useState<ProofreadKind[]>(() => allProofreadKinds())
  const [habitTerm, setHabitTerm] = useState<string | null>(null)
  const [result, setResult] = useState<ProofreadScanResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [ignoreBusy, setIgnoreBusy] = useState(false)
  const [note, setNote] = useState('')
  const [stale, setStale] = useState(false)
  const [proposal, setProposal] = useState<ShellProposalCardProps['proposal'] | null>(null)
  const [ignoreGap, setIgnoreGap] = useState('')
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.treeRevision}`
  requestGate.setScope(requestScope)

  const scan = async (nextScope: ProofreadScope) => {
    if (nextScope === 'document' && !props.activePath) {
      setResult(null)
      setNote(t('proofread.openDocFirst'))
      return
    }
    const ticket = requestGate.begin(requestScope)
    setBusy(true)
    setNote('')
    setStale(false)
    setProposal(null)
    const scanned = await safeRpcCall<ProofreadScanResponse>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'proofread.scan', {
      sessionId: props.sessionId,
      scope: nextScope,
      ...(nextScope === 'document' ? { path: props.activePath } : {}),
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!scanned.ok) { setResult(null); setNote(errorMessage(scanned, props.locale)); return }
    setResult(scanned.value)
    setNote(scanned.value.findings.length ? '' : t('proofread.none'))
  }

  useEffect(() => {
    setResult(null)
    setNote('')
    setBusy(false)
    setStale(false)
    setProposal(null)
    setHabitTerm(null)
    setIgnoreGap('')
  }, [props.sessionId, props.treeRevision])

  useEffect(() => {
    if (!props.request) return
    consumeProofreadRequest(props.request)
    setScope(props.request.scope)
    void scan(props.request.scope)
  }, [props.request?.nonce])

  const filter: ProofreadFilter = { kinds, habitTerm }
  const visible = result ? filterProofreadFindings(result.findings, filter) : []
  const grouped = groupFindingsByFile(visible)
  const counts = result ? kindCounts(result.findings) : kindCounts([])
  const currentVersion = result?.findings.find((item) => item.path === props.activePath)?.version
  const punctuationFixes = result && props.activePath && currentVersion
    ? documentPunctuationFindings(result.findings, props.activePath, currentVersion)
    : []

  const changeScope = (next: ProofreadScope) => {
    setScope(next)
    void scan(next)
  }

  const toggleKind = (kind: ProofreadKind) => {
    setKinds((current) => {
      const next = toggleProofreadKind(current, kind)
      if (!next.includes('habit')) setHabitTerm(null)
      return next.length ? next : current
    })
  }

  const openFinding = async (finding: ProofreadFinding) => {
    props.openDocument(finding.path, finding)
    const read = await safeRpcCall<{ version: string }>(() => props.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: finding.path,
    }))
    if (!read.ok) return
    if (isStaleFinding(finding, read.value.version)) {
      setStale(true)
      setNote(t('proofread.staleLocate'))
    }
  }

  const readDocument = async (path: string) => safeRpcCall<{ text: string; version: string }>(() => props.rpc.call('/manuscript', 'file.read', {
    sessionId: props.sessionId,
    path,
  }))

  const prepareEdit = async (path: string, build: (text: string, version: string) => ProofreadEditDraft | undefined, staleMessage: string) => {
    if (!canProposeProofreadPath(path)) {
      setNote(t('proofread.mdOnly'))
      return
    }
    const read = await readDocument(path)
    if (!read.ok) { setNote(errorMessage(read, props.locale)); return }
    const draft = build(read.value.text, read.value.version)
    if (!draft) { setNote(staleMessage); return }
    setProposal(toProposalMarker(draft))
    setNote('')
  }

  const applySuggestion = async (finding: ProofreadFinding) => {
    if (finding.suggestion === undefined) return
    if (props.editorDirty && finding.path === props.activePath) {
      setNote(t('proofread.saveBeforeApply'))
      return
    }
    await prepareEdit(finding.path, (text, version) => {
      if (isStaleFinding(finding, version)) {
        setStale(true)
        return undefined
      }
      return singleFindingEdit(text, finding)
    }, t('proofread.notUnique'))
  }

  const applyPunctuationBatch = async () => {
    if (!props.activePath) { setNote(t('proofread.openDocFirst')); return }
    if (props.editorDirty) { setNote(t('proofread.saveBeforeApply')); return }
    await prepareEdit(props.activePath, (text, version) => {
      const items = documentPunctuationFindings(result?.findings ?? [], props.activePath, version)
      if (!items.length) return undefined
      return batchPunctuationEdit(text, props.activePath, items)
    }, t('proofread.noPunctBatch'))
  }

  const ignoreSensitive = async (finding: ProofreadFinding) => {
    const term = quotedTerm(finding.message)
    if (!term || ignoreBusy) return
    setIgnoreBusy(true)
    setIgnoreGap('')
    const read = await safeRpcCall<{ text: string; version: string }>(() => props.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: SENSITIVE_ALLOW_PATH,
    }))
    let written: Awaited<ReturnType<typeof safeRpcCall<{ version: string }>>>
    if (!read.ok) {
      const missing = /not-found|missing/i.test(`${read.error.code ?? ''} ${read.error.message ?? ''}`)
      if (!missing) {
        setIgnoreBusy(false)
        setIgnoreGap(t('proofread.ignoreWriteFailed', { term, path: SENSITIVE_ALLOW_PATH }))
        return
      }
      written = await safeRpcCall<{ version: string }>(() => props.rpc.call('/manuscript', 'file.create', {
        sessionId: props.sessionId,
        path: SENSITIVE_ALLOW_PATH,
        text: appendIgnoreLine(null, term),
      }))
    } else {
      const next = appendIgnoreLine(read.value.text, term)
      if (next === read.value.text) {
        setIgnoreBusy(false)
        setNote(t('proofread.alreadyIgnored', { term }))
        return
      }
      written = await safeRpcCall<{ version: string }>(() => props.rpc.call('/manuscript', 'file.write', {
        sessionId: props.sessionId,
        path: SENSITIVE_ALLOW_PATH,
        text: next,
        version: read.value.version,
      }))
    }
    setIgnoreBusy(false)
    if (!written.ok) {
      setIgnoreGap(t('proofread.ignoreWriteFailed', { term, path: SENSITIVE_ALLOW_PATH }))
      return
    }
    setNote(t('proofread.ignoredTerm', { term }))
    void scan(scope)
  }

  const handleApplied = (path: string) => {
    setProposal(null)
    props.onApplied(path)
    void scan(scope)
  }

  return (
    <section
      className="proofread-panel"
      data-testid="editor-proofread-panel"
      aria-label={t('proofread.title')}>
      <header className="proofread-panel-header">
        <div>
          <h2>
            {t('proofread.title')}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={t('proofread.close')}
          onClick={props.onClose}>
          ×
        </button>
      </header>
      <div className="proofread-toolbar">
        <div
          className="proofread-scopes"
          role="group"
          aria-label={t('proofread.scope')}>
          <button
            type="button"
            aria-pressed={scope === 'document'}
            disabled={busy}
            onClick={() => changeScope('document')}>
            {t('proofread.currentDoc')}
          </button>
          <button
            type="button"
            aria-pressed={scope === 'manuscript'}
            disabled={busy}
            onClick={() => changeScope('manuscript')}>
            {t('proofread.wholeBook')}
          </button>
        </div>
        <button type="button" disabled={busy} onClick={() => void scan(scope)}>
          {busy ? <Fragment>
            {activityDots()}
            {t('proofread.checking')}
          </Fragment> : t('proofread.recheck')}
        </button>
      </div>
      <div
        className="proofread-kinds"
        role="group"
        aria-label={t('proofread.kinds')}>
        {PROOFREAD_KIND_CHIP_ORDER.map((kind) => <button
          key={kind}
          type="button"
          className="proofread-chip"
          aria-pressed={kinds.includes(kind)}
          onClick={() => toggleKind(kind)}>
          {`${proofreadKindLabel(kind)} ${counts[kind]}`}
        </button>)}
      </div>
      {result ? <div className="proofread-summary" role="status">
        {t('proofread.summary', { hits: visible.length, files: result.scannedFiles })}
        {result.truncated ? <strong>
          {t('proofread.truncated')}
        </strong> : null}
        {result.skipped ? <span>
          {proofreadSkippedText(result.skipped)}
        </span> : null}
      </div> : null}
      {stale ? <p className="warning" role="alert">
        {t('proofread.versionDiff')}
        <button type="button" onClick={() => void scan(scope)}>
          {t('proofread.recheck')}
        </button>
      </p> : null}
      {props.editorDirty && visible.length ? <p className="warning" role="alert">
        {t('proofread.saveBeforeJump')}
      </p> : null}
      {note ? <p className="muted" role="status">
        {note}
      </p> : null}
      {ignoreGap ? <p className="warning" role="status">
        {ignoreGap}
      </p> : null}
      {punctuationFixes.length && canProposeProofreadPath(props.activePath) ? <button
        type="button"
        className="proofread-batch"
        disabled={busy || props.editorDirty}
        onClick={() => void applyPunctuationBatch()}>
        {t('proofread.batchPunct', { count: punctuationFixes.length })}
      </button> : null}
      {proposal ? <div className="proofread-fix">
        <props.ProposalCard sessionId={props.sessionId} proposal={proposal} onApplied={handleApplied} />
      </div> : null}
      {busy && !result ? <div className="proofread-loading" role="status">
        {skeletonRows(['100%', '88%', '96%', '72%'])}
        <span className="sr-only">
          {t('proofread.checking')}
        </span>
      </div> : null}
      {grouped.length ? <ol className="proofread-results">
        {grouped.map((group) => <li key={group.path} className="proofread-file">
          <strong>
            {group.path}
          </strong>
          <ul>
            {group.findings.map((item, index) => <li
              key={`${item.path}:${item.start}:${item.kind}:${index}`}
              className="proofread-row">
              <button
                type="button"
                className="proofread-hit"
                disabled={props.editorDirty}
                onClick={() => void openFinding(item)}>
                <span className="proofread-head">
                  <i className={`proofread-severity ${item.severity}`} aria-hidden="true" />
                  <span className="proofread-kind">
                    {proofreadKindLabel(item.kind)}
                  </span>
                  <span className="proofread-message">
                    {item.message}
                  </span>
                </span>
                <span className="proofread-excerpt">
                  {ExcerptView(item)}
                </span>
                {item.suggestion !== undefined ? <span className="proofread-suggestion">
                  {t('proofread.suggestion', { text: item.suggestion || t('proofread.remove') })}
                </span> : null}
              </button>
              <div className="proofread-row-actions">
                {item.suggestion !== undefined ? <button
                  type="button"
                  disabled={busy || (props.editorDirty && item.path === props.activePath)}
                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); void applySuggestion(item) }}>
                  {t('proofread.apply')}
                </button> : null}
                {item.kind === 'sensitive' ? <button
                  type="button"
                  disabled={ignoreBusy}
                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); void ignoreSensitive(item) }}>
                  {t('proofread.ignoreSensitive')}
                </button> : null}
              </div>
            </li>)}
          </ul>
        </li>)}
      </ol> : null}
      {result?.habitStats.length ? <section className="proofread-habits" aria-label={t('proofread.habits')}>
        <h3>
          {t('proofread.habits')}
        </h3>
        {habitTerm ? <p className="muted">
          {t('proofread.viewingHabit', { term: habitTerm })}
          <button type="button" onClick={() => setHabitTerm(null)}>
            {t('common.clear')}
          </button>
        </p> : null}
        <table>
          <thead>
            <tr>
              <th>
                {t('proofread.word')}
              </th>
              <th>
                {t('proofread.count')}
              </th>
              <th>
                ‰
              </th>
            </tr>
          </thead>
          <tbody>
            {result.habitStats.map((stat) => <tr key={stat.term}>
              <td>
                <button
                  type="button"
                  className={habitTerm === stat.term ? 'active' : undefined}
                  onClick={() => {
                    setHabitTerm((current) => current === stat.term ? null : stat.term)
                    setKinds((current) => current.includes('habit') ? current : [...current, 'habit'])
                  }}>
                  {stat.term}
                </button>
              </td>
              <td>
                {String(stat.count)}
              </td>
              <td>
                {formatPerThousand(stat.perThousand)}
              </td>
            </tr>)}
          </tbody>
        </table>
      </section> : null}
    </section>
  );
}

function ExcerptView(finding: ProofreadFinding) {
  const parts = excerptParts(finding.excerpt, quotedTerm(finding.message))
  if (!parts.match) return finding.excerpt
  return (
    <span>
      {parts.before}
      <mark>
        {parts.match}
      </mark>
      {parts.after}
    </span>
  );
}

export function ProofreadSeat(props: ProofreadSeatProps) {
  const initial = pendingProofreadRequest()
  const [open, setOpen] = useState(() => initial !== null)
  const [request, setRequest] = useState<ProofreadRequest | null>(() => initial)
  useEffect(() => subscribeProofreadRequest((next) => {
    setOpen(true)
    setRequest(next)
  }), [])
  const sessionRef = useRef(props.sessionId)
  useEffect(() => {
    if (sessionRef.current === props.sessionId) return
    sessionRef.current = props.sessionId
    setOpen(false)
    setRequest(null)
  }, [props.sessionId])
  if (!open) return null
  return <ProofreadPanel {...props} request={request} onClose={() => setOpen(false)} />;
}
