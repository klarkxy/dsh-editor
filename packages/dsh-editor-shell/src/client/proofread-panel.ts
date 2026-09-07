import { createElement as e, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import { WORKBENCH_RPC_CHANNEL, type ProofreadScanResponse } from 'dsh-editor-workbench/contracts'
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
} from '../proofread-view.ts'
import { ProposalCard } from './chat.ts'
import { errorMessage, LatestRequestGate, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'

export type ProofreadRequest = { scope: ProofreadScope; nonce: number }

function toProposalMarker(draft: ProofreadEditDraft): ProposalMarker {
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

function ProofreadPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  navigationBlocked: boolean
  activePath: string
  request?: ProofreadRequest | null
  onOpen(finding: ProofreadFinding): void
  onApplied(path: string): void
}) {
  const [scope, setScope] = useState<ProofreadScope>('document')
  const [kinds, setKinds] = useState<ProofreadKind[]>(() => allProofreadKinds())
  const [habitTerm, setHabitTerm] = useState<string | null>(null)
  const [result, setResult] = useState<ProofreadScanResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [ignoreBusy, setIgnoreBusy] = useState(false)
  const [note, setNote] = useState('')
  const [stale, setStale] = useState(false)
  const [proposal, setProposal] = useState<ProposalMarker | null>(null)
  const [ignoreGap, setIgnoreGap] = useState('')
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.revision}`
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
    const scanned = await safeRpcCall<ProofreadScanResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'proofread.scan', {
      sessionId: props.sessionId,
      scope: nextScope,
      ...(nextScope === 'document' ? { path: props.activePath } : {}),
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!scanned.ok) { setResult(null); setNote(errorMessage(scanned)); return }
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
  }, [props.sessionId, props.revision])

  useEffect(() => {
    if (!props.request) return
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
    props.onOpen(finding)
    const read = await safeRpcCall<{ version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: finding.path,
    }))
    if (!read.ok) return
    if (isStaleFinding(finding, read.value.version)) {
      setStale(true)
      setNote(t('proofread.staleLocate'))
    }
  }

  const readDocument = async (path: string) => safeRpcCall<{ text: string; version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
    sessionId: props.sessionId,
    path,
  }))

  const prepareEdit = async (path: string, build: (text: string, version: string) => ProofreadEditDraft | undefined, staleMessage: string) => {
    if (!canProposeProofreadPath(path)) {
      setNote(t('proofread.mdOnly'))
      return
    }
    const read = await readDocument(path)
    if (!read.ok) { setNote(errorMessage(read)); return }
    const draft = build(read.value.text, read.value.version)
    if (!draft) { setNote(staleMessage); return }
    setProposal(toProposalMarker(draft))
    setNote('')
  }

  const applySuggestion = async (finding: ProofreadFinding) => {
    if (finding.suggestion === undefined) return
    if (props.navigationBlocked && finding.path === props.activePath) {
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
    if (props.navigationBlocked) { setNote(t('proofread.saveBeforeApply')); return }
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
    const read = await safeRpcCall<{ text: string; version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
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
      written = await safeRpcCall<{ version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.create', {
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
      written = await safeRpcCall<{ version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.write', {
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

  return e('section', { className: 'proofread-panel', 'aria-label': t('proofread.title') },
    e('header', { className: 'proofread-toolbar' },
      e('div', { className: 'proofread-scopes', role: 'group', 'aria-label': t('proofread.scope') },
        e('button', {
          type: 'button',
          'aria-pressed': scope === 'document',
          disabled: busy,
          onClick: () => changeScope('document'),
        }, t('proofread.currentDoc')),
        e('button', {
          type: 'button',
          'aria-pressed': scope === 'manuscript',
          disabled: busy,
          onClick: () => changeScope('manuscript'),
        }, t('proofread.wholeBook')),
      ),
      e('button', { type: 'button', disabled: busy, onClick: () => void scan(scope) }, busy ? t('proofread.checking') : t('proofread.recheck')),
    ),
    e('div', { className: 'proofread-kinds', role: 'group', 'aria-label': t('proofread.kinds') }, PROOFREAD_KIND_CHIP_ORDER.map((kind) => e('button', {
      key: kind,
      type: 'button',
      className: 'proofread-chip',
      'aria-pressed': kinds.includes(kind),
      onClick: () => toggleKind(kind),
    }, `${proofreadKindLabel(kind)} ${counts[kind]}`))),
    result ? e('div', { className: 'proofread-summary', role: 'status' },
      t('proofread.summary', { hits: visible.length, files: result.scannedFiles }),
      result.truncated ? e('strong', null, t('proofread.truncated')) : null,
      result.skipped ? e('span', null, proofreadSkippedText(result.skipped)) : null,
    ) : null,
    stale ? e('p', { className: 'warning', role: 'alert' },
      t('proofread.versionDiff'),
      e('button', { type: 'button', onClick: () => void scan(scope) }, t('proofread.recheck')),
    ) : null,
    props.navigationBlocked && visible.length ? e('p', { className: 'warning', role: 'alert' }, t('proofread.saveBeforeJump')) : null,
    note ? e('p', { className: 'muted', role: 'status' }, note) : null,
    ignoreGap ? e('p', { className: 'warning', role: 'status' }, ignoreGap) : null,
    punctuationFixes.length && canProposeProofreadPath(props.activePath) ? e('button', {
      type: 'button',
      className: 'proofread-batch',
      disabled: busy || props.navigationBlocked,
      onClick: () => void applyPunctuationBatch(),
    }, t('proofread.batchPunct', { count: punctuationFixes.length })) : null,
    proposal ? e('div', { className: 'proofread-fix' },
      e(ProposalCard, {
        ctx: props.ctx,
        sessionId: props.sessionId,
        proposal,
        onApplied: handleApplied,
      }),
    ) : null,
    grouped.length ? e('ol', { className: 'proofread-results' }, grouped.map((group) => e('li', { key: group.path, className: 'proofread-file' },
      e('strong', null, group.path),
      e('ul', null, group.findings.map((item, index) => e('li', { key: `${item.path}:${item.start}:${item.kind}:${index}`, className: 'proofread-row' },
        e('button', {
          type: 'button',
          className: 'proofread-hit',
          disabled: props.navigationBlocked,
          onClick: () => void openFinding(item),
        },
          e('span', { className: 'proofread-head' },
            e('i', { className: `proofread-severity ${item.severity}`, 'aria-hidden': 'true' }),
            e('span', { className: 'proofread-kind' }, proofreadKindLabel(item.kind)),
            e('span', { className: 'proofread-message' }, item.message),
          ),
          e('span', { className: 'proofread-excerpt' }, ExcerptView(item)),
          item.suggestion !== undefined ? e('span', { className: 'proofread-suggestion' }, t('proofread.suggestion', { text: item.suggestion || t('proofread.remove') })) : null,
        ),
        e('div', { className: 'proofread-row-actions' },
          item.suggestion !== undefined ? e('button', {
            type: 'button',
            disabled: busy || (props.navigationBlocked && item.path === props.activePath),
            onClick: (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); void applySuggestion(item) },
          }, t('proofread.apply')) : null,
          item.kind === 'sensitive' ? e('button', {
            type: 'button',
            disabled: ignoreBusy,
            onClick: (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); void ignoreSensitive(item) },
          }, t('proofread.ignoreSensitive')) : null,
        ),
      ))),
    ))) : null,
    result?.habitStats.length ? e('section', { className: 'proofread-habits', 'aria-label': t('proofread.habits') },
      e('h3', null, t('proofread.habits')),
      habitTerm ? e('p', { className: 'muted' }, t('proofread.viewingHabit', { term: habitTerm }), e('button', { type: 'button', onClick: () => setHabitTerm(null) }, t('common.clear'))) : null,
      e('table', null,
        e('thead', null, e('tr', null, e('th', null, t('proofread.word')), e('th', null, t('proofread.count')), e('th', null, '‰'))),
        e('tbody', null, result.habitStats.map((stat) => e('tr', { key: stat.term },
          e('td', null, e('button', {
            type: 'button',
            className: habitTerm === stat.term ? 'active' : undefined,
            onClick: () => {
              setHabitTerm((current) => current === stat.term ? null : stat.term)
              setKinds((current) => current.includes('habit') ? current : [...current, 'habit'])
            },
          }, stat.term)),
          e('td', null, String(stat.count)),
          e('td', null, formatPerThousand(stat.perThousand)),
        ))),
      ),
    ) : null,
  )
}

function ExcerptView(finding: ProofreadFinding) {
  const parts = excerptParts(finding.excerpt, quotedTerm(finding.message))
  if (!parts.match) return finding.excerpt
  return e('span', null, parts.before, e('mark', null, parts.match), parts.after)
}

export { ProofreadPanel }
