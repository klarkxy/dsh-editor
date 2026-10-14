import {
  Fragment,
  memo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Box,
  Button,
  Card,
  Flex,
  IconButton,
  Input,
  Notice,
  SegmentedControl,
  Text,
} from '../ui/index.ts'
import {
  answerApproval,
  answerQuestions,
  type ChatRow,
  type PendingInteraction,
  type QuestionAnswerItem,
} from '../adapter.ts'
import type { ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import type { ShellMessageCardContext, ShellMessageCardRegistry } from '../seats.ts'
import { Markdown } from './markdown.tsx'
import { CrossIcon } from './icons.tsx'
import { ActivityDots, SuccessMark } from './ui/index.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { t, type Locale } from '../i18n/index.ts'
import { ProposalCard } from './chat-proposal.tsx'
import type { ShellContext } from './shared.ts'

import {
  clusterChatRows,
  isChatStepRow,
  processDetailRows,
  stepPreview,
  toolStepTitle,
  turnProcessLabel,
} from '../model/chat-cards.ts'


/** DSH DisclosureRow：14px 标记 + 标题 + · + 摘要；作为 Disclosure summary 的行内容，箭头由 Disclosure 提供（样式里移到行尾）。 */
export function ChatStepHead(props: {
  label: ReactNode
  preview?: string
  tone?: 'muted' | 'ok' | 'error' | 'recovered'
  busy?: boolean
}) {
  const color = props.tone === 'error' ? 'red' : 'gray'
  const status = props.tone === 'error' ? 'error' : props.tone === 'ok' || props.tone === 'recovered' ? 'ok' : 'muted'
  return (
    <Flex align="center" gap="2" className="chat-step-head" minWidth="0" width="100%">
      <span className="chat-step-mark" aria-hidden="true">
        {props.busy
          ? <ActivityDots variant="typing" />
          : <span className={`chat-step-status is-${status}${status === 'error' ? ' chat-step-error-dot' : ''}`} />}
      </span>
      <Text size="2" color={color} className="chat-step-label" wrap="nowrap">
        {props.label}
      </Text>
      {props.preview ? <Fragment>
        <span className="chat-step-dot" aria-hidden="true" />
        <Text size="1" color={color} className="chat-step-preview" wrap="nowrap">
          {props.preview}
        </Text>
      </Fragment> : null}
    </Flex>
  )
}

export function ChatEntry(props: {
  as?: 'article' | 'details'
  className: string
  children?: ReactNode
  open?: boolean
  role?: string
  enter?: boolean
  'aria-live'?: 'polite' | 'off'
}) {
  /* 入场判定只在挂载时冻结一次(与原 Motion 变体行为一致):历史行完全不动画,
     之后 enter prop 翻转也不会重播;动画本体是纯 CSS 的 .chat-row-enter,
     reduced-motion 由全局媒体查询接管。 */
  const animate = useRef(props.enter !== false)
  const className = animate.current ? `${props.className} chat-row-enter` : props.className
  const Tag = props.as === 'details' ? 'details' : 'article'
  return (
    <Tag
      className={className}
      {...(props.as === 'details' ? { open: props.open } : {})}
      role={props.role}
      aria-live={props['aria-live']}>
      {props.children}
    </Tag>
  );
}

export function ChatStepItem(props: {
  className: string
  label: ReactNode
  preview?: string
  tone?: 'muted' | 'ok' | 'error' | 'recovered'
  expandable?: boolean
  busy?: boolean
  live?: boolean
  /** §5：失败的执行记录默认展开。 */
  defaultOpen?: boolean
  role?: string
  children?: ReactNode
}) {
  const className = `chat-row chat-step ${props.className}`
  if (!props.expandable) {
    return (
      <div className={className}>
        <ChatStepHead busy={props.busy} tone={props.tone} label={props.label} preview={props.preview} />
      </div>
    )
  }
  return (
    <div className={className} role={props.role} aria-live={props.live ? 'polite' : undefined}>
      <Disclosure
        className="chat-step-disclosure"
        defaultOpen={props.defaultOpen}
        summary={<ChatStepHead busy={props.busy} tone={props.tone} label={props.label} preview={props.preview} />}>
        {props.children ? <div className="chat-step-body">{props.children}</div> : null}
      </Disclosure>
    </div>
  )
}


export function ChatStepFromRow({ row }: { row: ChatRow; running?: boolean }) {
  if (row.role === 'thinking') {
    return (
      <ChatStepItem
        className="thinking"
        expandable={Boolean(row.text)}
        tone="muted"
        label={t('chat.think')}>
        {row.text}
      </ChatStepItem>
    )
  }
  const failed = Boolean(row.error && !row.recovered)
  const body = Boolean(row.reason || row.content)
  return (
    <ChatStepItem
      className={row.error ? (row.recovered ? 'tool recovered' : 'tool error') : 'tool'}
      expandable={body}
      defaultOpen={failed}
      tone={failed ? 'error' : 'ok'}
      role={failed ? 'status' : undefined}
      label={toolStepTitle(row)}>
      {row.reason ? <Text as="p" size="1" color={failed ? 'red' : 'gray'} className="tool-error-reason">
        {row.reason}
      </Text> : null}
      {row.content ? <pre className="chat-step-code">
        {row.content}
      </pre> : null}
    </ChatStepItem>
  )
}

/** Live turn: 单行 Disclosure 标着「运行中」，步骤保持展开直到回合结束。 */
export function ChatProcessStack(props: { children?: ReactNode; enter?: boolean }) {
  return (
    <ChatEntry className="chat-row chat-process-stack" enter={props.enter}>
      <Disclosure
        defaultOpen
        summary={<span className="chat-process-label">
          {t('chat.stepRunning')}
        </span>}>
        {props.children}
      </Disclosure>
    </ChatEntry>
  )
}

/** Settled DSH compact turn-process：单行 Disclosure，显示真实完成/失败状态，失败默认展开（§5）。 */
export function ChatProcessBlock(props: {
  rows: ChatRow[]
  enter?: boolean
}) {
  const failed = props.rows.some((row) => row.error && !row.recovered)
  const tools = props.rows.filter((row) => row.role === 'tool').length
  const label = turnProcessLabel({ tools })
  return (
    <ChatEntry className="chat-row chat-process" enter={props.enter}>
      <Disclosure
        defaultOpen={failed}
        summary={<span className="chat-process-label">
          {label}
          <span className={`chat-process-state${failed ? ' is-error' : ''}`}>
            {' · '}
            {failed ? t('chat.stepFailed') : t('chat.stepDone')}
          </span>
        </span>}>
        <div className="chat-process-body">
          {processDetailRows(props.rows).map((row) => <ChatStepFromRow key={row.id} row={row} />)}
        </div>
      </Disclosure>
    </ChatEntry>
  )
}

export function PendingCard({ item }: { item: PendingInteraction }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [tab, setTab] = useState(0)
  if (item.kind === 'approval') {
    const decide = (outcome: 'allowed-once' | 'rejected') => {
      setBusy(true)
      void answerApproval(item, outcome).then((receipt) => {
        if (!receipt.accepted) setNote(t('note.proposalStale'))
      }).catch(() => setNote(t('note.submitFailed'))).finally(() => setBusy(false))
    }
    return (
      <Card size="2">
        <article className="pending-card" aria-label={t('chat.approvalTitle')}>
          <Flex direction="column" gap="3">
            <Text size="2" weight="medium">
              {t('chat.needsAuth')}
            </Text>
            <Text size="2">
              {item.payload.reason || t('chat.allowStep')}
              {item.payload.toolName ? <code> {item.payload.toolName}</code> : null}
            </Text>
            <Flex gap="2" wrap="wrap">
              <Button type="button" variant="primary" disabled={busy} onClick={() => decide('allowed-once')}>
                {t('chat.allowOnce')}
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => decide('rejected')}>
                {t('chat.refuse')}
              </Button>
            </Flex>
            {note ? <Text size="1" className="warning" color="red" role="alert">
              {note}
            </Text> : null}
          </Flex>
        </article>
      </Card>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const encoded: QuestionAnswerItem[] = item.payload.questions.map((question) => {
      const value = answers[question.id]?.trim() ?? ''
      const labels = question.options?.map((option) => option.label) ?? []
      return labels.includes(value)
        ? { id: question.id, selected: [value] }
        : { id: question.id, selected: [], ...(value ? { custom: value } : {}) }
    })
    if (encoded.some((answer) => answer.selected.length === 0 && !answer.custom)) { setNote(t('chat.answerAll')); return }
    setBusy(true)
    void answerQuestions(item, encoded).then((receipt) => {
      if (!receipt.accepted) setNote(t('chat.questionsStale'))
    }).catch(() => setNote(t('note.submitFailed'))).finally(() => setBusy(false))
  }
  const questions = item.payload.questions
  const current = questions.length ? questions[Math.min(tab, questions.length - 1)] : undefined
  const isAnswered = (id: string, source: Record<string, string> = answers) => Boolean(source[id]?.trim())
  const choose = (questionId: string, label: string) => {
    const next = { ...answers, [questionId]: label }
    setAnswers(next)
    setNote('')
    for (let step = 1; step < questions.length; step += 1) {
      const index = (tab + step) % questions.length
      if (!isAnswered(questions[index].id, next)) { setTab(index); return }
    }
  }
  return (
    <Card size="2">
      <form
        className="pending-card"
        aria-label={t('chat.answerQuestions')}
        onSubmit={submit}>
        <Flex direction="column" gap="3">
          {questions.length > 1 ? <SegmentedControl
            className="question-tabs"
            aria-label={t('chat.answerQuestions')}
            value={String(tab)}
            onValueChange={(value) => setTab(Number(value))}
            options={questions.map((question, index) => ({
              value: String(index),
              label: isAnswered(question.id) ? '✓' : String(index + 1),
              className: `question-tab${index === tab ? ' is-active' : ''}${isAnswered(question.id) ? ' is-done' : ''}`,
              'aria-label': t('chat.questionTab', { index: index + 1 }),
            }))} /> : null}
          {current ? <Box className="question-panel" role="tabpanel">
            <Flex direction="column" gap="2">
              <Text size="1" color="gray" weight="medium">
                {current.header ?? t('chat.needsAnswers')}
              </Text>
              <Text size="2">
                {current.question}
              </Text>
              {current.detail ? <Text size="1" color="gray">
                {current.detail}
              </Text> : null}
              {current.options?.length ? <Flex className="question-options" direction="column" gap="2">
                {current.options.map((option) => <Button
                  key={option.label}
                  type="button"
                  variant="secondary"
                  className={`question-option${answers[current.id] === option.label ? ' is-selected' : ''}`}
                  aria-pressed={answers[current.id] === option.label}
                  onClick={() => choose(current.id, option.label)}>
                  <Flex direction="column" align="start" gap="1">
                    <Text size="2" weight="medium">
                      {option.label}
                    </Text>
                    {option.description ? <Text size="1" color="gray">
                      {option.description}
                    </Text> : null}
                  </Flex>
                </Button>)}
              </Flex> : null}
              <Input
                placeholder={t('chat.customAnswer')}
                aria-label={t('chat.customAnswerFor', { question: current.question })}
                value={current.options?.some((option) => option.label === answers[current.id]) ? '' : answers[current.id] ?? ''}
                onChange={(value) => {
                  setAnswers((old) => ({ ...old, [current.id]: value }))
                  setNote('')
                }}
                className="question-custom" />
            </Flex>
          </Box> : null}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Fragment>
              <ActivityDots />
              {t('chat.submitting')}
            </Fragment> : t('chat.submitAllAnswers')}
          </Button>
          {note ? <Text size="1" className="warning" color="red" role="alert">
            {note}
          </Text> : null}
        </Flex>
      </form>
    </Card>
  );
}

/**
 * workbench /dsh-editor-workbench 通道的 proposal.prepare/apply 在不同 kind 下的响应体。
 * 与内核 ProposalMarker 保持对齐：edit 走 /manuscript 通道；create、章纲/章末小结与
 * split/merge/renames 走 workbench，prepare 响应按 kind 包裹。
 */

export function InitGuideCard(props: { state: 'explore' | 'interview'; busy: boolean; running: boolean; done: boolean; note: string; onStart(): void; onDismiss(): void }) {
  const explore = props.state === 'explore'
  return (
    <Box asChild>
      <details className="init-guide-quiet" aria-label={t('chat.initQuietTitle')}>
        <summary>
          <Text size="1" color="gray">
            {t('chat.initQuietTitle')}
          </Text>
        </summary>
        <Text as="p" size="2" my="2">
          {explore ? t('chat.initExplore') : t('chat.initInterview')}
        </Text>
        {props.done
          ? <Text as="p" size="2" role="status">
          <SuccessMark />
          {' '}
          {t('chat.initDone')}
        </Text>
          : <Flex className="init-guide-actions" gap="2" wrap="wrap">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={props.busy || props.running}
            onClick={props.onStart}>
            {props.running ? <Fragment>
              <ActivityDots />
              {t('chat.initRunning')}
            </Fragment> : t('chat.initStart')}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={props.busy} onClick={props.onDismiss}>
            {t('common.ignore')}
          </Button>
        </Flex>}
        {props.note ? <Text size="1" className="warning" color="red" role="alert">
          {props.note}
        </Text> : null}
      </details>
    </Box>
  );
}

/** 旧版会话顶部的迁移横幅：新建写作会话继续作品，旧会话保持可读；关闭仅记忆在内存。 */
export function LegacyMigrationBanner(props: { onMigrate(): void; onDismiss(): void }) {
  return (
    <Notice
      className="migration-banner"
      role="note"
      aria-label={t('chat.legacyMigrationTitle')}
      tone="info"
      action={<span className="migration-banner-actions">
        <Button type="button" size="sm" variant="secondary" onClick={props.onMigrate}>
          {t('chat.legacyMigrationAction')}
        </Button>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          label={t('common.close')}
          onClick={props.onDismiss}>
          <CrossIcon size={14} />
        </IconButton>
      </span>}>
      {t('chat.legacyMigrationBanner')}
    </Notice>
  );
}

export function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceiptBundle }) {
  /* V3 轻量请求的回执是 {sources:[]}：不展示空注入回执；V1/V2 历史消息照常渲染。 */
  if (!receipt.sources.length) return null
  const fixed = receipt.sources.filter((item) => item.kind !== 'worldbook')
  const includedFixed = fixed.filter((item) => item.status === 'included' && item.includedChars > 0).length
  const worldbook = receipt.sources.filter((item) => item.kind === 'worldbook')
  const matchedByText = (value: string | undefined) => value === 'both' ? t('chat.requestAndDoc') : value === 'saved-document' ? t('chat.currentDoc') : t('chat.thisRequest')
  return (
    <Box asChild>
      <details className="project-context-receipt">
        <summary>
          <Text size="1" color="gray">
            {`${t('chat.contextSummary', { included: includedFixed, total: fixed.length, worldbook: worldbook.length })}${receipt.authorPreferencesChars ? t('chat.contextAuthorPref', { count: receipt.authorPreferencesChars }) : ''}${receipt.authorMemoryChars ? t('chat.contextAuthorMemory', { count: receipt.authorMemoryChars }) : ''}`}
          </Text>
        </summary>
        <Box asChild my="2">
          <ul>
            {receipt.sources.map((item) => <li key={item.path}>
              <Text size="1" color="gray">
                <code>
                  {item.path}
                </code>
                {` · ${item.status === 'included'
                  ? item.includedChars > 0 ? t('chat.includedChars', { count: item.includedChars }) : item.truncated ? t('chat.notIncludedCap') : t('chat.emptyFile')
                  : item.status === 'missing' ? t('chat.missingFile') : t('chat.readFailed')}`}
                {item.truncated ? t('chat.truncated') : ''}
                {item.kind === 'worldbook' ? t('chat.worldbookMatch', { priority: item.priority ?? 0, matched: `${matchedByText(item.matchedBy)}${item.matchedTriggers?.length ? ` (${item.matchedTriggers.join('、')})` : ''}` }) : ''}
                {item.version ? ` · ${item.version}` : ''}
              </Text>
            </li>)}
          </ul>
        </Box>
        {receipt.scan ? <Text as="p" size="1" color="gray" className="muted">
          {t('chat.worldbookScan', { scanned: receipt.scan.scanned, unmatched: receipt.scan.unmatched, disabled: receipt.scan.disabled, invalid: receipt.scan.invalid, limits: receipt.scan.limits, errors: receipt.scan.readErrors })}
        </Text> : null}
      </details>
    </Box>
  );
}

type ChatRowViewProps = {
  row: ChatRow
  ctx: ShellContext
  sessionId: string
  locale: Locale
  /* 注册表内容变化用 tick 破坏 memo(对象本身原地可变)。 */
  cardTick: number
  enter: boolean
  messageCards?: ShellMessageCardRegistry
  messageCardContext: ShellMessageCardContext
  onApplied(path: string): void
}

/* 单行 memo:流式期间 transcript 每个令牌都换新引用,但 rows 按 nodes 引用缓存,
   未变化的行凭稳定的 row/props 引用跳过重渲染(Markdown 也随之跳过解析);
   locale/cardTick 变化会破坏 memo,保证 t() 文案与插件卡及时更新。 */
export const ChatRowView = memo(function ChatRowView(props: ChatRowViewProps) {
  const { row } = props
  if (row.proposal) return (
    <ProposalCard
      ctx={props.ctx}
      sessionId={props.sessionId}
      proposal={row.proposal}
      receiptId={row.id}
      onApplied={props.onApplied} />
  );
  const registered = row.toolName ? props.messageCards?.get(row.toolName) : undefined
  const pluginCard = registered?.render({ result: row.result ?? row.content ?? row.text, context: props.messageCardContext })
  if (pluginCard != null) return (
    <Fragment>
      {pluginCard}
    </Fragment>
  );
  if (isChatStepRow(row, props.messageCards) || row.role === 'thinking' || (row.role === 'tool' && (row.error || row.content))) {
    return <ChatStepFromRow row={row} />
  }
  return (
    <ChatEntry className={`chat-row ${row.role}`} enter={props.enter}>
      {row.role === 'user'
        ? <div className="dsh-partner__bubble">
          <Text size="2" as="p">
            {row.text || t('chat.noText')}
          </Text>
          {row.detail ? <Text as="p" size="1" color="gray" mt="1">
            {row.detail}
          </Text> : null}
          {row.projectContextReceipt ? <ProjectContextReceiptView receipt={row.projectContextReceipt} /> : null}
        </div>
        : row.role === 'assistant' && row.text
          ? <Box>
            <Text size="2" as="div">
              <Markdown text={row.text} />
            </Text>
            {row.detail ? <Text as="p" size="1" color="gray" mt="1">
              {row.detail}
            </Text> : null}
            {row.projectContextReceipt ? <ProjectContextReceiptView receipt={row.projectContextReceipt} /> : null}
          </Box>
          : <Box>
            <Text size="2" as="p">
              {row.text || t('chat.noText')}
            </Text>
            {row.detail ? <Text as="p" size="1" color="gray" mt="1">
              {row.detail}
            </Text> : null}
            {row.projectContextReceipt ? <ProjectContextReceiptView receipt={row.projectContextReceipt} /> : null}
          </Box>}
    </ChatEntry>
  );
})

/* 停止必须在 cancel 结算后松开 outgoing；拒绝或 RPC 失败也不能把发送闸门永久锁在 accepted。
   与 rows 对齐后的清场仍由 outgoingIsCanonical 负责，这里只覆盖显式停止。 */
