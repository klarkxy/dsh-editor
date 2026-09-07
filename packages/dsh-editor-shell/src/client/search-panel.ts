import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { errorMessage, LatestRequestGate, safeRpcCall, searchSkippedText, worldbookPaperProjection, type RevealRequest, type ShellContext } from './shared.ts'
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

function SearchPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  navigationBlocked: boolean
  onOpen(hit: SearchHit): void
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('project')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.revision}`
  requestGate.setScope(requestScope)

  useEffect(() => {
    setQuery('')
    setResult(null)
    setNote('')
    setBusy(false)
  }, [props.sessionId, props.revision])

  useEffect(() => {
    globalThis.setTimeout(() => input.current?.focus(), 0)
  }, [props.sessionId])

  const search = async (raw: string, nextScope: SearchScope) => {
    const value = raw.trim()
    if (!value) { setNote(t('search.emptyQuery')); return }
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
    setResult(searched.value)
    setNote(searched.value.results.length ? '' : t('search.noMatch'))
  }

  const grouped = result ? groupSearchHits(result.results) : []

  return e('section', { className: 'search-panel', 'aria-label': t('search.title') },
    e('form', { role: 'search', onSubmit: (event: FormEvent) => { event.preventDefault(); void search(query, scope) } },
      e('input', {
        ref: input,
        value: query,
        maxLength: 120,
        placeholder: t('search.placeholder'),
        'aria-label': t('search.aria'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      }),
      e('button', { type: 'submit', disabled: busy || !query.trim(), 'aria-label': t('search.start') }, busy ? '…' : t('search.go')),
      e('select', {
        value: scope,
        'aria-label': t('search.scope'),
        onChange: (event: ChangeEvent<HTMLSelectElement>) => setScope(event.target.value === 'manuscript' ? 'manuscript' : 'project'),
      },
        e('option', { value: 'project' }, t('search.wholeWork')),
        e('option', { value: 'manuscript' }, t('search.manuscriptOnly')),
      ),
    ),
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
