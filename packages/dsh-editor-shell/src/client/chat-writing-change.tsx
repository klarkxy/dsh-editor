import { Fragment, useEffect, useRef, useState } from 'react'
import { WORKBENCH_RPC_CHANNEL, type WritingChangeEdit, type WritingChangeFile, type WritingChangeGetResponse, type WritingChangeReceipt, type WritingChangeRename } from 'dsh-editor-workbench/contracts'
import type { ShellMessageCardContext } from '../seats.ts'
import { Badge, Button, Flex, Text } from '../ui/index.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { ActivityDots, SuccessMark } from './ui/index.ts'
import { ProposalDiffView } from './proposal-diff-view.tsx'
import { displayTreeFileName } from '../project-files.ts'
import { errorMessage, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'

/*
 * writing_change 的写入回执卡：写入在工具调用成功时已落盘，这里只展示
 * 状态、定位与撤销。挂载即读 writing.change.get，重载历史也能呈现
 * 已撤销等最终状态；错误一律以可见文本呈现，不靠颜色。
 */
export function WritingChangeCard(props: {
  ctx: ShellContext
  sessionId: string
  receipt: WritingChangeReceipt
  /** 本轮刚产生的行（非历史）：需要触发无导航刷新。 */
  live?: boolean
  messageCardContext: ShellMessageCardContext
}) {
  const { receipt } = props
  const [status, setStatus] = useState(receipt.status)
  const [files, setFiles] = useState<WritingChangeFile[]>([])
  const [edits, setEdits] = useState<WritingChangeEdit[] | undefined>()
  const [renames, setRenames] = useState<WritingChangeRename[] | undefined>()
  const [note, setNote] = useState(receipt.message ?? '')
  const [busy, setBusy] = useState(false)
  const notifiedRef = useRef(false)

  const notify = (paths: readonly string[], moves: readonly { from: string; to: string }[]) => {
    for (const path of paths) props.messageCardContext.onApplied(path)
    for (const move of moves) props.messageCardContext.onMoved?.(move.from, move.to)
  }

  /* 挂载拉取回执与 diff 数据；live 行随后走无导航刷新（树 + 打开文档就地同步）。 */
  useEffect(() => {
    let live = true
    void (async () => {
      const result = await safeRpcCall<WritingChangeGetResponse>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'writing.change.get', {
        sessionId: props.sessionId,
        id: receipt.id,
      }))
      if (!live) return
      const moves: { from: string; to: string }[] = []
      if (result.ok) {
        setStatus(result.value.receipt.status)
        setFiles(result.value.files)
        setEdits(result.value.edits)
        setRenames(result.value.renames)
        if (result.value.receipt.message && result.value.receipt.message !== receipt.message) setNote(result.value.receipt.message)
        if (result.value.renames) moves.push(...result.value.renames)
        else if (result.value.receipt.kind === 'merge' && result.value.files[1]) {
          moves.push({ from: result.value.files[1].path, to: result.value.files[0]!.path })
        }
      }
      if (props.live && !notifiedRef.current && receipt.status === 'applied') {
        notifiedRef.current = true
        notify(receipt.paths, moves)
      }
    })()
    return () => { live = false }
  }, [props.sessionId, receipt.id])

  const undo = async () => {
    setBusy(true)
    const result = await safeRpcCall<WritingChangeReceipt>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'writing.change.undo', {
      sessionId: props.sessionId,
      id: receipt.id,
    }))
    setBusy(false)
    if (!result.ok) {
      /* 拒绝/草稿守卫消息由 workbench 直接给出（已是作者可读文案），
         空消息才退回通用错误映射。 */
      setNote(result.error.message || errorMessage(result))
      return
    }
    setStatus(result.value.status)
    setNote(result.value.message ?? t('chat.changeUndone'))
    const moves: { from: string; to: string }[] = renames
      ? renames.map((entry) => ({ from: entry.to, to: entry.from }))
      : receipt.kind === 'merge' && files[1] ? [{ from: files[1].path, to: files[0]!.path }] : []
    notify(receipt.paths, moves)
  }

  const locate = () => {
    const target = files.find((file) => file.after !== null)?.path ?? receipt.paths[0]
    if (!target) return
    props.messageCardContext.onLocate?.(target, edits?.[0]?.newText ?? '')
  }

  const headline = receipt.kind === 'edit'
    ? t('chat.changedFile', { file: displayTreeFileName(receipt.paths[0] ?? ''), count: receipt.count })
    : receipt.kind === 'create'
      ? t('chat.createdFile', { file: displayTreeFileName(receipt.paths[0] ?? '') })
      : receipt.kind === 'split'
        ? t('chat.splitFileDone', { file: displayTreeFileName(receipt.paths[0] ?? '') })
        : receipt.kind === 'merge'
          ? t('chat.mergedFile', {
            source: displayTreeFileName(receipt.paths[1] ?? ''),
            file: displayTreeFileName(receipt.paths[0] ?? ''),
          })
          : t('chat.movedFiles', { count: receipt.count })

  return (
    <article className={`proposal-card writing-change ${status}`} data-testid="dsh-chat-writing-change" aria-label={t('chat.changeCardLabel')}>
      <Flex className="writing-change-line" align="center" gap="2" wrap="wrap">
        <Text size="2">
          {headline}
        </Text>
        <Badge className="cards-badge" tone={status === 'undone' ? 'neutral' : 'accent'}>
          {status === 'undone' ? t('chat.changeUndone') : t('chat.changeApplied')}
        </Badge>
      </Flex>
      {receipt.summary ? <Text as="p" size="1" color="gray" mt="1">
        {receipt.summary}
      </Text> : null}
      <Flex className="proposal-actions" gap="2" wrap="wrap" mt="2">
        <Button type="button" variant="secondary" size="sm" onClick={locate} data-testid="dsh-change-locate">
          {t('chat.changeLocate')}
        </Button>
        {status === 'applied' ? <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void undo()}
          data-testid="dsh-change-undo">
          {busy ? <Fragment><ActivityDots />{t('chat.changeUndoing')}</Fragment> : t('chat.changeUndo')}
        </Button> : null}
      </Flex>
      {note ? <Text size="1" color="gray" role="status" mt="2" as="p">
        {status === 'undone' ? <SuccessMark /> : null}
        {note}
      </Text> : null}
      <Disclosure className="writing-change-diff" summary={t('chat.changeViewDiff')}>
        <Flex direction="column" gap="3">
          {files.map((file) => <section key={file.path} className="writing-change-file">
            <Text size="1" color="gray">
              <code title={file.path}>{displayTreeFileName(file.path)}</code>
              {file.after === null ? ` ${t('chat.changeFileRemoved')}` : file.before === null ? ` ${t('chat.changeFileCreated')}` : ''}
            </Text>
            {file.before !== null && file.after !== null
              ? <ProposalDiffView before={file.before} after={file.after} />
              : <pre className="writing-change-full">{file.after ?? file.before ?? ''}</pre>}
          </section>)}
        </Flex>
      </Disclosure>
    </article>
  )
}
