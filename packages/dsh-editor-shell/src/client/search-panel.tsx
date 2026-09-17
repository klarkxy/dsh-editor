import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Box, Button, Callout, Card, Flex, ScrollArea, Text, TextField } from '@radix-ui/themes'
import { Select } from './select.tsx'
import { ActivityDots, isImeEvent } from './ui/index.ts'
import { m, useChromeMotion } from './ui/motion.ts'
import { errorMessage, isStaleFailure, LatestRequestGate, safeRpcCall, searchSkippedText, worldbookPaperProjection, type RevealRequest, type ShellContext } from './shared.ts'
import {
  planReplace,
  prepareReplaceWrite,
  summarizeReplacePlan,
  type ReplacePlan,
} from '../search-replace.ts'
import { isAuxiliaryAuthorFile } from '../auxiliary-files.ts'
import { documentDirectory, searchPathInDirectory } from '../project-files.ts'
import { t } from '../i18n/index.ts'

export type SearchScope = 'project' | 'directory'

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

export type SearchTextRequest = {
  sessionId: string
  query: string
  scope: 'project'
  directory?: string
}

/** Host payload: project walk by default; directory scope sends the active document folder. */
export function searchTextRequest(input: {
  sessionId: string
  query: string
  scope: SearchScope
  activePath: string
}): SearchTextRequest {
  const directory = input.scope === 'directory' ? documentDirectory(input.activePath) : ''
  return directory
    ? { sessionId: input.sessionId, query: input.query, scope: 'project', directory }
    : { sessionId: input.sessionId, query: input.query, scope: 'project' }
}

/** Defense-in-depth folder filter after Host results. Never lock the RPC to 正文/. */
export function scopeSearchResults(response: SearchResponse, scope: SearchScope, activePath: string): SearchResponse {
  if (scope !== 'directory') return response
  const directory = documentDirectory(activePath)
  if (!directory) return response
  return {
    ...response,
    results: response.results.filter((hit) => searchPathInDirectory(hit.path, directory)),
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
    const searched = await safeRpcCall<SearchResponse>(() => props.ctx.connection.rpc.call('/manuscript', 'search.text', searchTextRequest({
      sessionId: props.sessionId,
      query: value,
      scope: nextScope,
      activePath: props.activePath,
    })))
    if (!requestGate.isCurrent(ticket)) return
    setBusy(false)
    if (!searched.ok) { setResult(null); setNote(errorMessage(searched)); return }
    const accepted = scopeSearchResults(acceptSearchResults(searched.value), nextScope, props.activePath)
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
  const blockImeEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
      event.preventDefault()
    }
  }
  return (
    <m.section className="search-panel" aria-label={t('search.title')} {...panelMotion}>
      <Card size="1" mx="3" mb="2">
        <Flex direction="column" gap="2">
          <Flex asChild align="center" gap="2" wrap="wrap">
            <form
              role="search"
              onSubmit={(event: FormEvent) => { event.preventDefault(); void search(query, scope) }}>
              {props.onQueryChange ? null : <TextField.Root
                ref={input}
                size="2"
                style={{ flex: 1, minWidth: 0 }}
                value={query}
                maxLength={120}
                placeholder={t('search.placeholder')}
                aria-label={t('search.aria')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                onKeyDown={blockImeEnter} />}
              <Button
                type="submit"
                size="2"
                variant="solid"
                disabled={busy || !query.trim()}
                aria-label={t('search.start')}>
                {busy ? <ActivityDots /> : t('search.go')}
              </Button>
              <Select
                value={scope}
                aria-label={t('search.scope')}
                options={[
                  { value: 'project', label: t('search.wholeWork') },
                  { value: 'directory', label: t('search.manuscriptOnly') },
                ]}
                onChange={(value: string) => setScope(value === 'directory' ? 'directory' : 'project')} />
            </form>
          </Flex>
          <Flex asChild align="center" gap="2">
            <form
              className="search-replace"
              onSubmit={(event: FormEvent) => { event.preventDefault(); openReplaceConfirm() }}>
              <TextField.Root
                size="2"
                style={{ flex: 1, minWidth: 0 }}
                value={replacement}
                placeholder={t('search.replacePlaceholder')}
                aria-label={t('search.replaceAria')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setReplacement(event.target.value)}
                onKeyDown={blockImeEnter} />
              <Button type="submit" size="2" variant="soft" disabled={busy || !replaceEnabled}>
                {t('search.replaceAll')}
              </Button>
            </form>
          </Flex>
          {confirming && replacePlan && replaceSummary ? <Box
            className="search-replace-confirm"
            role="region"
            aria-label={t('search.replaceConfirmTitle')}>
            <Text as="p" className="search-summary" size="1" color="gray" role="status">
              {t('search.replaceSummary', { files: replaceSummary.files, count: replaceSummary.occurrences })}
            </Text>
            {replaceSummary.skipped ? <Text as="p" size="1" color="gray">
              {t('search.replaceOverlap', { count: replaceSummary.skipped })}
            </Text> : null}
            {replaceSummary.staleFiles ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceStale', { count: replaceSummary.staleFiles })}
            </Text> : null}
            {replaceSummary.perFile.length ? <Box asChild>
              <ul className="search-results">
                {replaceSummary.perFile.map((file) => <li key={file.path} className="search-file">
                  <Text size="1">
                    {t('search.replaceFileHits', { path: file.path, count: file.count })}
                  </Text>
                </li>)}
              </ul>
            </Box> : null}
            <Flex className="search-replace-actions" align="center" gap="2" mt="2">
              <Button
                type="button"
                size="2"
                variant="solid"
                disabled={busy || !replacePlan.files.length}
                onClick={() => void runReplace(replacePlan)}>
                {busy ? <Fragment>
                  <ActivityDots />
                  {t('search.replaceConfirm')}
                </Fragment> : t('search.replaceConfirm')}
              </Button>
              <Button type="button" size="2" variant="soft" color="gray" disabled={busy} onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </Flex>
          </Box> : null}
          {outcome ? <Box className="search-replace-result" role="status">
            <Text as="p" size="2">
              {t('search.replaceResult', { files: outcome.files, count: outcome.occurrences })}
            </Text>
            {outcome.stale.length ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceStale', { count: outcome.stale.length })}
            </Text> : null}
            {outcome.changed.length ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceChanged', { count: outcome.changed.length })}
            </Text> : null}
            {outcome.failed.length ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceFailed', { count: outcome.failed.length })}
            </Text> : null}
            <Button
              type="button"
              size="2"
              variant="soft"
              disabled={busy}
              onClick={() => void search(query, scope, { keepOutcome: true })}>
              {busy ? <Fragment>
                <ActivityDots />
                {t('search.replaceAgain')}
              </Fragment> : t('search.replaceAgain')}
            </Button>
          </Box> : null}
          {result ? <Flex className="search-summary" wrap="wrap" gap="2" role="status">
            <Text size="1" color="gray">
              {t('search.summary', { hits: result.results.length, files: result.scannedFiles })}
            </Text>
            {result.truncated ? <Text size="1" weight="bold">
              {t('search.capped')}
            </Text> : null}
            {result.skipped ? <Text size="1" color="gray">
              {searchSkippedText(result.skipped)}
            </Text> : null}
          </Flex> : null}
          {props.navigationBlocked && result?.results.length ? <Callout.Root className="warning" color="red" size="1" role="alert">
            <Callout.Text>
              {t('search.saveBeforeJump')}
            </Callout.Text>
          </Callout.Root> : null}
          {note ? <Text as="p" size="1" color="gray" role="status">
            {note}
          </Text> : null}
          {grouped.length ? <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 240 }}>
            <Box asChild>
              <ol className="search-results">
                {grouped.map((group) => <li key={group.path} className="search-file">
                  <Text size="1" weight="medium">
                    {group.path}
                  </Text>
                  <ul>
                    {group.hits.map((hit, index) => <li key={`${hit.path}:${hit.start}:${index}`}>
                      <Box>
                        <Button
                          type="button"
                          size="1"
                          variant="ghost"
                          color="gray"
                          disabled={props.navigationBlocked}
                          onClick={() => props.onOpen(hit)}>
                          <Text size="1">
                            {t('search.hitLine', { line: hit.line, excerpt: hit.excerpt })}
                          </Text>
                        </Button>
                      </Box>
                    </li>)}
                  </ul>
                </li>)}
              </ol>
            </Box>
          </ScrollArea> : null}
        </Flex>
      </Card>
    </m.section>
  );
}

export { SearchPanel }
