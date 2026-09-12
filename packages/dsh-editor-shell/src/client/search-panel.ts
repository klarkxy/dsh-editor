import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Select } from './select.tsx'
import { m, useChromeMotion } from './ui/motion.ts'
import { errorMessage, isStaleFailure, LatestRequestGate, safeRpcCall, searchSkippedText, worldbookPaperProjection, type RevealRequest, type ShellContext } from './shared.ts'
import {
  planReplace,
  prepareReplaceWrite,
  summarizeReplacePlan,
  type ReplacePlan,
} from '../search-replace.ts'
import { isAuxiliaryAuthorFile } from '../auxiliary-files.ts'
import { t } from '../i18n/index.ts'

export type SearchScope = 'project' | 'manuscript'

export type SearchHit = {
  path: string
  line: number
  column: number
  start: number
  end: number
  excerpt: string
  version: string
}

export type SearchResponse = {
  results: SearchHit[]
  scannedFiles: number
  scannedBytes: number
  skipped: number
  truncated: boolean
}

export type GroupedSearchHits = { path: string; hits: SearchHit[] }[]

export type ReplaceOutcome = {
  files: number
  occurrences: number
  stale: string[]
  changed: string[]
  failed: string[]
}

/** Drop assistant/config files before grouping, counting, or planning replace. */
export function acceptSearchResults(response: SearchResponse): SearchResponse {
  return {
    ...response,
    results: response.results.filter((hit) => !isAuxiliaryAuthorFile(hit.path)),
  }
}

export function groupSearchHits(hits: readonly SearchHit[]): GroupedSearchHits {
  const groups = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.path)
    if (list) list.push(hit)
    else groups.set(hit.path, [hit])
  }
  return [...groups.entries()].map(([path, groupHits]) => ({ path, hits: groupHits }))
}

export function paperRevealRange(path: string, text: string, hit: Pick<SearchHit, 'start' | 'end'>): { from: number; to: number } {
  const offset = worldbookPaperProjection(path, text).offset
  const from = Math.max(0, hit.start - offset)
  const to = Math.max(from, hit.end - offset)
  return { from, to }
}

export function toRevealRequest(hit: SearchHit, nonce = Date.now()): RevealRequest {
  return { ...hit, nonce }
}

export function canReplaceAll(input: { query: string; replacement: string; hits: number }): boolean {
  return input.hits > 0 && input.replacement !== input.query
}

export function replaceBlockedByDirty(input: { activePath: string; activeDirty: boolean; paths: readonly string[] }): boolean {
  return input.activeDirty && Boolean(input.activePath) && input.paths.includes(input.activePath)
}

function SearchPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  navigationBlocked: boolean
  activePath: string
  activeDirty: boolean
  query?: string
  onQueryChange?(value: string): void
  submitTick?: number
  onOpen(hit: SearchHit): void
  onReplaced?(paths: string[]): void
}) {
  const [internalQuery, setInternalQuery] = useState('')
  const query = props.onQueryChange ? props.query ?? '' : internalQuery
  const setQuery = (value: string) => {
    if (props.onQueryChange) props.onQueryChange(value)
    else setInternalQuery(value)
  }
  const [replacement, setReplacement] = useState('')
  const [scope, setScope] = useState<SearchScope>('project')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [outcome, setOutcome] = useState<ReplaceOutcome | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.revision}`
  requestGate.setScope(requestScope)

  useEffect(() => {
    if (!props.onQueryChange) setInternalQuery('')
    setReplacement('')
    setResult(null)
    setNote('')
    setBusy(false)
    setConfirming(false)
    setOutcome(null)
  }, [props.sessionId, props.revision])

  useEffect(() => {
    globalThis.setTimeout(() => input.current?.focus(), 0)
  }, [props.sessionId])

  const search = async (raw: string, nextScope: SearchScope, options?: { keepOutcome?: boolean }) => {
    const value = raw.trim()
    if (!value) { setNote(t('search.emptyQuery')); return }
    if (!options?.keepOutcome) setOutcome(null)
    setConfirming(false)
    const ticket = requestGate.begin(requestScope)
    setBusy(true)
    setNote('')
    const searched = await safeRpcCall<SearchResponse>(() => props.ctx.connection.rpc.call('/manuscript', 'search.text', {
      sessionId: props.sessionId,
      query: value,
      scope: nextScope,
    }))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!searched.ok) { setResult(null); setNote(errorMessage(searched)); return }
    const accepted = acceptSearchResults(searched.value)
    setResult(accepted)
    setNote(accepted.results.length ? '' : t('search.noMatch'))
  }

  useEffect(() => {
    if (props.submitTick) void search(query, scope)
  }, [props.submitTick])

  const replacePlan = result ? planReplace(result.results, replacement) : null
  const replaceSummary = replacePlan ? summarizeReplacePlan(replacePlan) : null
  const replaceEnabled = canReplaceAll({ query, replacement, hits: result?.results.length ?? 0 })

  const openReplaceConfirm = () => {
    if (!replacePlan || !replaceEnabled) return
    if (replaceBlockedByDirty({ activePath: props.activePath, activeDirty: props.activeDirty, paths: replacePlan.files.map((file) => file.path) })) {
      setNote(t('search.replaceSaveFirst'))
      return
    }
    setOutcome(null)
    setConfirming(true)
  }

  const runReplace = async (plan: ReplacePlan) => {
    if (replaceBlockedByDirty({ activePath: props.activePath, activeDirty: props.activeDirty, paths: plan.files.map((file) => file.path) })) {
      setNote(t('search.replaceSaveFirst'))
      setConfirming(false)
      return
    }
    const ticket = requestGate.begin(requestScope)
    setBusy(true)
    setNote('')
    setConfirming(false)
    const needle = query.trim()
    const stale = [...plan.stale]
    const changed: string[] = []
    const failed: string[] = []
    const written: string[] = []
    let occurrences = 0

    for (const file of plan.files) {
      const read = await safeRpcCall<{ text: string; version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
        sessionId: props.sessionId,
        path: file.path,
      }))
      if (!requestGate.isCurrent(ticket)) return
      if (!read.ok) {
        failed.push(file.path)
        continue
      }
      const prepared = prepareReplaceWrite(file, read.value, needle, plan.replacement)
      if (!prepared.ok) {
        if (prepared.reason === 'stale') stale.push(file.path)
        else changed.push(file.path)
        continue
      }
      const writtenFile = await safeRpcCall<{ version: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.write', {
        sessionId: props.sessionId,
        path: file.path,
        text: prepared.text,
        version: read.value.version,
      }))
      if (!requestGate.isCurrent(ticket)) return
      if (!writtenFile.ok) {
        if (isStaleFailure(writtenFile)) stale.push(file.path)
        else failed.push(file.path)
        continue
      }
      written.push(file.path)
      occurrences += file.spans.length
    }

    setOutcome({ files: written.length, occurrences, stale, changed, failed })
    if (written.length) props.onReplaced?.(written)
    if (!requestGate.isCurrent(ticket)) return
    await search(query, scope, { keepOutcome: true })
  }

  const grouped = result ? groupSearchHits(result.results) : []

  const panelMotion = useChromeMotion('panel')
  return e(m.section, { className: 'search-panel', 'aria-label': t('search.title'), ...panelMotion },
    e('form', { role: 'search', onSubmit: (event: FormEvent) => { event.preventDefault(); void search(query, scope) } },
      props.onQueryChange ? null : e('input', {
        ref: input,
        value: query,
        maxLength: 120,
        placeholder: t('search.placeholder'),
        'aria-label': t('search.aria'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      }),
      e('button', { type: 'submit', disabled: busy || !query.trim(), 'aria-label': t('search.start') }, busy ? '…' : t('search.go')),
      e(Select, {
        value: scope,
        'aria-label': t('search.scope'),
        options: [
          { value: 'project', label: t('search.wholeWork') },
          { value: 'manuscript', label: t('search.manuscriptOnly') },
        ],
        onChange: (value: string) => setScope(value === 'manuscript' ? 'manuscript' : 'project'),
      }),
    ),
    e('form', {
      className: 'search-replace',
      onSubmit: (event: FormEvent) => { event.preventDefault(); openReplaceConfirm() },
    },
      e('input', {
        value: replacement,
        placeholder: t('search.replacePlaceholder'),
        'aria-label': t('search.replaceAria'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => setReplacement(event.target.value),
      }),
      e('button', { type: 'submit', disabled: busy || !replaceEnabled }, t('search.replaceAll')),
    ),
    confirming && replacePlan && replaceSummary ? e('div', { className: 'search-replace-confirm', role: 'region', 'aria-label': t('search.replaceConfirmTitle') },
      e('p', { className: 'search-summary', role: 'status' }, t('search.replaceSummary', { files: replaceSummary.files, count: replaceSummary.occurrences })),
      replaceSummary.skipped ? e('p', { className: 'muted' }, t('search.replaceOverlap', { count: replaceSummary.skipped })) : null,
      replaceSummary.staleFiles ? e('p', { className: 'warning' }, t('search.replaceStale', { count: replaceSummary.staleFiles })) : null,
      replaceSummary.perFile.length ? e('ul', { className: 'search-results' }, replaceSummary.perFile.map((file) => e('li', { key: file.path, className: 'search-file' },
        t('search.replaceFileHits', { path: file.path, count: file.count }),
      ))) : null,
      e('div', { className: 'search-replace-actions' },
        e('button', { type: 'button', disabled: busy || !replacePlan.files.length, onClick: () => void runReplace(replacePlan) }, t('search.replaceConfirm')),
        e('button', { type: 'button', disabled: busy, onClick: () => setConfirming(false) }, t('common.cancel')),
      ),
    ) : null,
    outcome ? e('div', { className: 'search-replace-result', role: 'status' },
      e('p', null, t('search.replaceResult', { files: outcome.files, count: outcome.occurrences })),
      outcome.stale.length ? e('p', { className: 'warning' }, t('search.replaceStale', { count: outcome.stale.length })) : null,
      outcome.changed.length ? e('p', { className: 'warning' }, t('search.replaceChanged', { count: outcome.changed.length })) : null,
      outcome.failed.length ? e('p', { className: 'warning' }, t('search.replaceFailed', { count: outcome.failed.length })) : null,
      e('button', { type: 'button', disabled: busy, onClick: () => void search(query, scope, { keepOutcome: true }) }, t('search.replaceAgain')),
    ) : null,
    result ? e('div', { className: 'search-summary', role: 'status' },
      t('search.summary', { hits: result.results.length, files: result.scannedFiles }),
      result.truncated ? e('strong', null, t('search.capped')) : null,
      result.skipped ? e('span', null, searchSkippedText(result.skipped)) : null,
    ) : null,
    props.navigationBlocked && result?.results.length ? e('p', { className: 'warning', role: 'alert' }, t('search.saveBeforeJump')) : null,
    note ? e('p', { className: 'muted', role: 'status' }, note) : null,
    grouped.length ? e('ol', { className: 'search-results' }, grouped.map((group) => e('li', { key: group.path, className: 'search-file' },
      e('strong', null, group.path),
      e('ul', null, group.hits.map((hit, index) => e('li', { key: `${hit.path}:${hit.start}:${index}` },
        e('button', { type: 'button', disabled: props.navigationBlocked, onClick: () => props.onOpen(hit) },
          e('span', null, t('search.hitLine', { line: hit.line, excerpt: hit.excerpt })),
        ),
      ))),
    ))) : null,
  )
}

export { SearchPanel }
