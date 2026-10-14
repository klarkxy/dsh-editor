import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Callout, Card, Flex, Heading, IconButton, Text, TextArea } from '@radix-ui/themes'
import type { ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import {
  anchorOccurrences,
  basenameOf,
  buildMergeProposal,
  buildSplitProposal,
  dirnameOf,
  isValidChapterFileName,
  normalizeChapterFileName,
  suggestSplitName,
} from '../chapter-ops-view.ts'
import { ProposalCard } from './chat.tsx'
import { CrossIcon } from './icons.tsx'
import { ActivityDots, Button, Dialog, Input } from './ui/index.ts'
import { errorMessage, safeRpcCall, type ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'

import {
  initialSplitAnchor,
  type ChapterOpsRequest,
  type EditorSnapshot,
} from '../model/chapter-ops.ts'

function SplitFormDialog(props: {
  open?: boolean
  path: string
  initialAnchor: string
  initialName: string
  files: readonly string[]
  sessionId: string
  ctx: ShellContext
  onCancel(): void
  onReady(proposal: ProposalMarker): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const [anchor, setAnchor] = useState(props.initialAnchor)
  const [newName, setNewName] = useState(props.initialName)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  const submit = async () => {
    const fileName = normalizeChapterFileName(newName)
    if (!isValidChapterFileName(fileName)) { setNote(t('chapterOps.nameInvalid')); return }
    const directory = dirnameOf(props.path)
    const newPath = directory ? `${directory}/${fileName}` : fileName
    if (newPath === props.path || props.files.includes(newPath)) { setNote(t('chapterOps.nameExists')); return }
    if (!anchor.trim()) { setNote(t('chapterOps.anchorEmpty')); return }
    setBusy(true)
    setNote('')
    const existing = await safeRpcCall<{ text: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: newPath,
    }))
    if (existing.ok) {
      setBusy(false)
      setNote(t('chapterOps.nameExists'))
      return
    }
    const read = await safeRpcCall<{ text: string }>(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', {
      sessionId: props.sessionId,
      path: props.path,
    }))
    setBusy(false)
    if (!read.ok) { setNote(errorMessage(read) || t('chapterOps.readFailed')); return }
    const count = anchorOccurrences(read.value.text, anchor)
    if (count === 0) { setNote(t('chapterOps.anchorMissing')); return }
    if (count !== 1) { setNote(t('chapterOps.anchorAmbiguous')); return }
    props.onReady(buildSplitProposal({
      path: props.path,
      anchor,
      newPath,
      summary: t('chapterOps.splitSummary', { path: props.path, newPath }),
    }))
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !busy) props.onCancel() }}
      title={t('chapterOps.splitTitle')}
      className="file-dialog prompt-dialog chapter-ops-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      dismissible={!busy}
      initialFocusRef={textarea}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Heading as="h2" size="4" id="chapter-ops-split-title">
            {t('chapterOps.splitTitle')}
          </Heading>
          <IconButton
            variant="ghost"
            color="gray"
            className="icon-button"
            aria-label={t('common.close')}
            disabled={busy}
            onClick={props.onCancel}>
            <CrossIcon size={14} />
          </IconButton>
        </Flex>
        <Flex
          direction="column"
          gap="3"
          asChild>
          <form
            onSubmit={(event: FormEvent) => { event.preventDefault(); if (!busy) void submit() }}>
            <Text size="1" color="gray">
              {t('chapterOps.splitFile')}
              {' '}
              <code>
                {props.path}
              </code>
            </Text>
            <Text as="label" size="2">
              <Flex direction="column" gap="1">
                {t('chapterOps.anchor')}
                <TextArea
                  ref={textarea}
                  value={anchor}
                  rows={4}
                  disabled={busy}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setAnchor(event.target.value)} />
              </Flex>
            </Text>
            <Text size="1" color="gray">
              {t('chapterOps.anchorHint')}
            </Text>
            <Text as="label" size="2">
              <Flex direction="column" gap="1">
                {t('chapterOps.newFileName')}
                <Input
                  value={newName}
                  maxLength={120}
                  disabled={busy}
                  onChange={setNewName} />
              </Flex>
            </Text>
            {note ? <Callout.Root className="warning" color="red" role="alert" size="1">
              <Callout.Text>
                {note}
              </Callout.Text>
            </Callout.Root> : null}
            <Flex justify="end" gap="2">
              <Button disabled={busy} onClick={props.onCancel}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={anchor.trim() && newName.trim() ? 'primary' : undefined}
                type="submit"
                className="primary-action"
                disabled={busy || !anchor.trim() || !newName.trim()}>
                {busy ? <Fragment>
                  <ActivityDots />
                  {t('common.loading')}
                </Fragment> : t('chapterOps.preview')}
              </Button>
            </Flex>
          </form>
        </Flex>
      </Flex>
    </Dialog>
  );
}

function ProposalReviewDialog(props: {
  open?: boolean
  ctx: ShellContext
  sessionId: string
  proposal: ProposalMarker
  onApplied(path: string): void
  onClose(): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const close = useRef<HTMLButtonElement | null>(null)
  const title = props.proposal.kind === 'merge' ? t('chapterOps.mergeTitle') : t('chapterOps.reviewTitle')
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next) props.onClose() }}
      title={title}
      className="file-dialog chapter-ops-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      initialFocusRef={close}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Heading as="h2" size="4" id="chapter-ops-review-title">
            {title}
          </Heading>
          <IconButton
            ref={close}
            variant="ghost"
            color="gray"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={props.onClose}>
            <CrossIcon size={14} />
          </IconButton>
        </Flex>
        {props.proposal.kind === 'merge' ? <Text size="1" color="gray">
          {t('chapterOps.mergeArchiveHint')}
        </Text> : null}
        <Card className="chapter-ops-card">
          <ProposalCard
            ctx={props.ctx}
            sessionId={props.sessionId}
            proposal={props.proposal}
            onApplied={props.onApplied} />
        </Card>
        <Flex justify="end" gap="2">
          <Button onClick={props.onClose}>
            {t('chapterOps.closeReview')}
          </Button>
        </Flex>
      </Flex>
    </Dialog>
  );
}

export function ChapterOpsLayer(props: {
  ctx: ShellContext
  sessionId: string
  files: readonly string[]
  request: ChapterOpsRequest | null
  getEditorSnapshot(): EditorSnapshot | null
  onClose(): void
  onApplied(path: string): void
  returnFocusRef?: RefObject<HTMLElement | null>
}): ReactNode {
  useLocale()
  const [review, setReview] = useState<{ proposal: ProposalMarker } | null>(null)
  useEffect(() => {
    setReview(null)
  }, [props.request])
  const open = Boolean(props.request)
  const snapshot = useRef<{ request: ChapterOpsRequest; review: { proposal: ProposalMarker } | null } | null>(null)
  if (props.request) snapshot.current = { request: props.request, review }
  const display = snapshot.current
  if (!display) return null
  const request = display.request
  if (display.review) {
    return (
      <ProposalReviewDialog
        open={open}
        ctx={props.ctx}
        sessionId={props.sessionId}
        proposal={display.review.proposal}
        onApplied={props.onApplied}
        onClose={props.onClose}
        returnFocusRef={props.returnFocusRef} />
    );
  }
  if (request.kind === 'merge') {
    return (
      <ProposalReviewDialog
        open={open}
        ctx={props.ctx}
        sessionId={props.sessionId}
        proposal={buildMergeProposal({
          path: request.path,
          sourcePath: request.sourcePath,
          summary: t('chapterOps.mergeSummary', { path: request.path, sourcePath: request.sourcePath }),
        })}
        onApplied={props.onApplied}
        onClose={props.onClose}
        returnFocusRef={props.returnFocusRef} />
    );
  }
  const suggested = suggestSplitName(request.path, props.files)
  return (
    <SplitFormDialog
      key={`${request.path}:${request.source}`}
      open={open}
      path={request.path}
      initialAnchor={initialSplitAnchor(request.source, props.getEditorSnapshot())}
      initialName={basenameOf(suggested)}
      files={props.files}
      sessionId={props.sessionId}
      ctx={props.ctx}
      onCancel={props.onClose}
      onReady={(proposal) => setReview({ proposal })}
      returnFocusRef={props.returnFocusRef} />
  );
}
