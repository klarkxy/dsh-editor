import { useEffect, useState, type RefObject } from 'react'
import { Button, Callout, Flex, Heading, Text } from '@radix-ui/themes'
import { t } from '../i18n/index.ts'
import { errorMessage, safeRpcCall, type ShellContext } from './shared.ts'
import type { SearchHit, SearchResponse } from './search-panel.tsx'
import { Dialog } from './ui/index.ts'
import { lookupReferences, type ReferenceLookupResult } from './reference-lookup.ts'

type LookupState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: ReferenceLookupResult }
  | { kind: 'error'; message: string }

/** Mounted only by an explicit menu action. All navigation stays with the host. */
export function ReferenceLookupDialog(props: {
  ctx: ShellContext
  sessionId: string
  query: string
  files: readonly string[]
  revision: number
  returnFocusRef: RefObject<HTMLElement>
  onClose(): void
  onOpen(path: string, hit?: SearchHit): void
  onPin(path: string): void
}) {
  const [state, setState] = useState<LookupState>({ kind: 'loading' })
  const [retry, setRetry] = useState(0)
  const { ctx, sessionId, query, files, revision } = props
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void lookupReferences({
      query,
      files,
      signal: controller.signal,
      search: async (directory, searchQuery, signal) => {
        const result = await safeRpcCall<SearchResponse>(() => ctx.connection.rpc.call('/manuscript', 'search.text', {
          sessionId, query: searchQuery, scope: 'project', directory,
        }, signal))
        if (!result.ok) throw new Error(errorMessage(result))
        return result.value
      },
    }).then((result) => {
      if (active) setState({ kind: 'ready', result })
    }).catch((error: unknown) => {
      if (active) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    // A closed dialog, different document/session or later search owns no old replies.
    return () => { active = false; controller.abort() }
  }, [ctx.connection.rpc, sessionId, query, files, revision, retry])

  return <Dialog
    open
    onOpenChange={(open) => { if (!open) props.onClose() }}
    title={t('reference.title')}
    className="file-dialog editor-action-dialog file-dialog-overlay"
    returnFocusRef={props.returnFocusRef}>
    <Flex direction="column" gap="3">
      <Heading as="h2" size="4">{t('reference.title')}</Heading>
      <Text size="2">{t('reference.query', { query })}</Text>
      <Text size="2" color="gray">{t('reference.description')}</Text>
      {state.kind === 'loading' ? <Text role="status" size="2">{t('common.loading')}</Text> : null}
      {state.kind === 'error' ? <Callout.Root color="red" size="1" role="alert">
        <Callout.Text>{state.message}</Callout.Text>
      </Callout.Root> : null}
      {state.kind === 'ready' ? <>
        {state.result.failures.map((failure) => <Callout.Root key={failure.directory} color="red" size="1" role="alert">
          <Callout.Text>{t('reference.failed', { directory: failure.directory, error: failure.message })}</Callout.Text>
        </Callout.Root>)}
        {state.result.truncated || state.result.skipped ? <Text role="status" size="2" color="gray">
          {t('reference.partial', { skipped: state.result.skipped })}
        </Text> : null}
        {!state.result.candidates.length && !state.result.failures.length ? <Text role="status" size="2">
          {t('reference.noMatch')}
        </Text> : null}
        <Flex direction="column" gap="3" style={{ maxHeight: '45vh', overflowY: 'auto' }} aria-label={t('reference.results')}>
          {state.result.candidates.map((candidate) => <section key={candidate.path} data-testid="reference-candidate">
            <Text as="p" size="2" weight="medium" style={{ overflowWrap: 'anywhere' }}>{candidate.path}</Text>
            {candidate.hit ? <Text as="p" size="2" color="gray" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {candidate.hit.excerpt}
            </Text> : null}
            <Flex gap="2" mt="2">
              <Button type="button" variant="soft" size="2" onClick={() => { props.onClose(); props.onOpen(candidate.path, candidate.hit) }}>
                {t('reference.open')}
              </Button>
              <Button type="button" variant="soft" color="gray" size="2" onClick={() => { props.onClose(); props.onPin(candidate.path) }}>
                {t('reference.pin')}
              </Button>
            </Flex>
          </section>)}
        </Flex>
      </> : null}
      <Flex justify="end" gap="2">
        {state.kind === 'error' || (state.kind === 'ready' && state.result.failures.length > 0) ? <Button type="button" variant="soft" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button> : null}
        <Button type="button" variant="soft" color="gray" onClick={props.onClose}>{t('common.close')}</Button>
      </Flex>
    </Flex>
  </Dialog>
}
