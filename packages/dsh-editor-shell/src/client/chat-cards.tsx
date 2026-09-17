import {
  Fragment,
  memo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  IconButton,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes'
import {
  answerApproval,
  answerQuestions,
  type ChatRow,
  type PendingInteraction,
  type QuestionAnswerItem,
} from '../adapter.ts'
import type { AuthorMemoryMarker, ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import type { ShellMessageCardContext, ShellMessageCardRegistry } from '../seats.ts'
import { Markdown } from './markdown.tsx'
import { ActivityDots, SuccessMark } from './ui/index.ts'
import { t, type Locale } from '../i18n/index.ts'
import { ProposalCard } from './chat-proposal.tsx'
import type { ShellContext } from './shared.ts'

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
              {t('chat.allowStep')}
            </Text>
            <Flex gap="2" wrap="wrap">
              <Button type="button" variant="solid" disabled={busy} onClick={() => decide('allowed-once')}>
                {t('chat.allowOnce')}
              </Button>
              <Button type="button" variant="soft" color="gray" disabled={busy} onClick={() => decide('rejected')}>
                {t('chat.refuse')}
              </Button>
            </Flex>
            {note ? <Text size="1" className="warning" color="red">
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
          {questions.length > 1 ? <SegmentedControl.Root
            className="question-tabs"
            value={String(tab)}
            onValueChange={(value) => setTab(Number(value))}
            size="1">
            {questions.map((question, index) => <SegmentedControl.Item
              key={question.id}
              value={String(index)}
              className={`question-tab${index === tab ? ' is-active' : ''}${isAnswered(question.id) ? ' is-done' : ''}`}
              aria-label={t('chat.questionTab', { index: index + 1 })}>
              {isAnswered(question.id) ? '✓' : String(index + 1)}
            </SegmentedControl.Item>)}
          </SegmentedControl.Root> : null}
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
                  variant="soft"
                  color={answers[current.id] === option.label ? undefined : 'gray'}
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
              <TextField.Root
                placeholder={t('chat.customAnswer')}
                aria-label={t('chat.customAnswerFor', { question: current.question })}
                value={current.options?.some((option) => option.label === answers[current.id]) ? '' : answers[current.id] ?? ''}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const value = event.target.value
                  setAnswers((old) => ({ ...old, [current.id]: value }))
                  setNote('')
                }}
                ref={(el) => { el?.classList.add('question-custom') }} />
            </Flex>
          </Box> : null}
          <Button type="submit" variant="solid" disabled={busy}>
            {busy ? <Fragment>
              <ActivityDots />
              {t('chat.submitting')}
            </Fragment> : t('chat.submitAllAnswers')}
          </Button>
          {note ? <Text size="1" className="warning" color="red">
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

export function MemoryCard(props: { memory: AuthorMemoryMarker; onAccept(observation: string): Promise<boolean> | boolean }) {
  const [state, setState] = useState<'ready' | 'saving' | 'saved' | 'rejected' | 'failed'>('ready')
  const [note, setNote] = useState('')
  const accept = async () => {
    if (state !== 'ready') return
    setState('saving'); setNote(t('chat.writingMemory'))
    let ok = false
    try {
      ok = Boolean(await props.onAccept(props.memory.observation))
    } catch {
      ok = false
    }
    if (ok) { setState('saved'); setNote(t('chat.remembered')) }
    else { setState('failed'); setNote(t('chat.memoryFull')) }
  }
  return (
    <Card size="2">
      <article className={`memory-card ${state}`} aria-label={t('chat.memoryTitle')}>
        <Flex direction="column" gap="3">
          <Box className="memory-observation">
            <Text size="2">
              {props.memory.observation}
            </Text>
          </Box>
          <Box className="memory-reason">
            <Text size="1" color="gray">
              {t('chat.why')}
            </Text>
            <Text size="2">
              {props.memory.reason}
            </Text>
          </Box>
          <Flex asChild align="center" gap="2" wrap="wrap">
            <footer>
              <Text size="1" color={state === 'failed' ? 'red' : 'gray'} role={state === 'failed' ? 'alert' : 'status'}>
                {state === 'saving' ? <ActivityDots /> : state === 'saved' ? <SuccessMark /> : null}
                {note}
              </Text>
              {state === 'ready' ? <Button type="button" variant="solid" onClick={() => void accept()}>
                {t('chat.remember')}
              </Button> : null}
              {state === 'ready' ? <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={() => { setState('rejected'); setNote(t('chat.ignoredMemory')) }}>
                {t('common.ignore')}
              </Button> : null}
            </footer>
          </Flex>
        </Flex>
      </article>
    </Card>
  );
}

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
            variant="solid"
            size="1"
            disabled={props.busy || props.running}
            onClick={props.onStart}>
            {props.running ? <Fragment>
              <ActivityDots />
              {t('chat.initRunning')}
            </Fragment> : t('chat.initStart')}
          </Button>
          <Button type="button" variant="soft" color="gray" size="1" disabled={props.busy} onClick={props.onDismiss}>
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
    <Callout.Root
      className="migration-banner"
      role="note"
      aria-label={t('chat.legacyMigrationTitle')}
      color="indigo"
      size="1">
      <Callout.Text>
        {t('chat.legacyMigrationBanner')}
      </Callout.Text>
      <Flex className="migration-banner-actions" align="center" gap="2" mt="2">
        <Button type="button" size="1" variant="soft" onClick={props.onMigrate}>
          {t('chat.legacyMigrationAction')}
        </Button>
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          size="1"
          aria-label={t('common.close')}
          onClick={props.onDismiss}>
          ×
        </IconButton>
      </Flex>
    </Callout.Root>
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
  onAcceptMemory(observation: string): Promise<boolean> | boolean
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
      onApplied={props.onApplied} />
  );
  if (row.memory) return <MemoryCard memory={row.memory} onAccept={props.onAcceptMemory} />;
  const registered = row.toolName ? props.messageCards?.get(row.toolName) : undefined
  const pluginCard = registered?.render({ result: row.result ?? row.content ?? row.text, context: props.messageCardContext })
  if (pluginCard != null) return (
    <Fragment>
      {pluginCard}
    </Fragment>
  );
  if (row.role === 'thinking') {
    return (
      <ChatEntry as="details" className="chat-row thinking" enter={props.enter}>
        <summary>
          <Text size="1" color="gray">
            {t('chat.thinkingProcess')}
          </Text>
        </summary>
        <Text as="p" size="2" mt="2">
          {row.text}
        </Text>
      </ChatEntry>
    );
  }
  if (row.role === 'tool' && row.error) {
    return (
      <ChatEntry
        as="details"
        className={row.recovered ? 'chat-row tool recovered' : 'chat-row tool error'}
        role={row.recovered ? undefined : 'status'}
        enter={props.enter}>
        <summary>
          <Flex align="center" gap="2">
            <Badge color={row.recovered ? 'gray' : 'red'} variant="soft" size="1">
              {row.recovered ? row.text : `⚠ ${row.text}`}
            </Badge>
          </Flex>
        </summary>
        {row.recovered
          ? <Box mt="2">
            {row.reason ? <Text as="p" size="2" className="tool-error-reason">
              {row.reason}
            </Text> : null}
            {row.content ? <Box asChild mt="2">
              <pre>
                {row.content}
              </pre>
            </Box> : null}
            {row.detail ? <Text as="p" size="1" color="gray" mt="1">
              {row.detail}
            </Text> : null}
          </Box>
          : <Callout.Root color="red" mt="2">
            {row.reason ? <Callout.Text className="tool-error-reason">
              {row.reason}
            </Callout.Text> : null}
            {row.content ? <Box asChild mt="2">
              <pre>
                {row.content}
              </pre>
            </Box> : null}
            {row.detail ? <Text size="1" mt="1">
              {row.detail}
            </Text> : null}
          </Callout.Root>}
      </ChatEntry>
    );
  }
  if (row.role === 'tool' && row.content) {
    return (
      <ChatEntry as="details" className="chat-row tool" enter={props.enter}>
        <summary>
          <Badge variant="soft" color="gray" size="1">
            {row.text}
          </Badge>
        </summary>
        <Box asChild mt="2">
          <pre>
            {row.content}
          </pre>
        </Box>
        {row.detail ? <Text as="p" size="1" color="gray" mt="1">
          {row.detail}
        </Text> : null}
      </ChatEntry>
    );
  }
  return (
    <ChatEntry className={`chat-row ${row.role}`} enter={props.enter}>
      {row.role === 'user'
        ? <Card size="2">
          <Text size="2" as="p">
            {row.text || t('chat.noText')}
          </Text>
          {row.detail ? <Text as="p" size="1" color="gray" mt="1">
            {row.detail}
          </Text> : null}
          {row.projectContextReceipt ? <ProjectContextReceiptView receipt={row.projectContextReceipt} /> : null}
        </Card>
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
