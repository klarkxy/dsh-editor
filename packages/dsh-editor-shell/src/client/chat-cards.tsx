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
  answerApproval,
  answerQuestions,
  type ChatRow,
  type PendingInteraction,
  type QuestionAnswerItem,
} from '../adapter.ts'
import type { AuthorMemoryMarker, ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import type { ShellMessageCardContext, ShellMessageCardRegistry } from '../seats.ts'
import { Markdown } from './markdown.tsx'
import { ActivityDots, ActivityText, SuccessMark } from './ui/index.ts'
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
      <article className="pending-card" aria-label={t('chat.approvalTitle')}>
        <strong>
          {t('chat.needsAuth')}
        </strong>
        <p>
          {t('chat.allowStep')}
        </p>
        <div>
          <button type="button" disabled={busy} onClick={() => decide('allowed-once')}>
            {t('chat.allowOnce')}
          </button>
          <button type="button" disabled={busy} onClick={() => decide('rejected')}>
            {t('chat.refuse')}
          </button>
        </div>
        {note ? <small className="warning">
          {note}
        </small> : null}
      </article>
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
    <form
      className="pending-card"
      aria-label={t('chat.answerQuestions')}
      onSubmit={submit}>
      {questions.length > 1 ? <div className="question-tabs" role="tablist">
        {questions.map((question, index) => <button
          key={question.id}
          type="button"
          role="tab"
          aria-selected={index === tab}
          aria-label={t('chat.questionTab', { index: index + 1 })}
          className={`question-tab${index === tab ? ' is-active' : ''}${isAnswered(question.id) ? ' is-done' : ''}`}
          onClick={() => setTab(index)}>
          {isAnswered(question.id) ? '✓' : String(index + 1)}
        </button>)}
      </div> : null}
      {current ? <section className="question-panel" role="tabpanel">
        <strong>
          {current.header ?? t('chat.needsAnswers')}
        </strong>
        <p>
          {current.question}
        </p>
        {current.detail ? <small>
          {current.detail}
        </small> : null}
        {current.options?.length ? <div className="question-options">
          {current.options.map((option) => <button
            key={option.label}
            type="button"
            className={`question-option${answers[current.id] === option.label ? ' is-selected' : ''}`}
            aria-pressed={answers[current.id] === option.label}
            onClick={() => choose(current.id, option.label)}>
            <strong>
              {option.label}
            </strong>
            {option.description ? <small>
              {option.description}
            </small> : null}
          </button>)}
        </div> : null}
        <input
          className="question-custom"
          placeholder={t('chat.customAnswer')}
          aria-label={t('chat.customAnswerFor', { question: current.question })}
          value={current.options?.some((option) => option.label === answers[current.id]) ? '' : answers[current.id] ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const value = event.target.value
            setAnswers((old) => ({ ...old, [current.id]: value }))
            setNote('')
          }} />
      </section> : null}
      <button type="submit" disabled={busy}>
        {busy ? <Fragment>
          <ActivityDots />
          {t('chat.submitting')}
        </Fragment> : t('chat.submitAllAnswers')}
      </button>
      {note ? <small className="warning">
        {note}
      </small> : null}
    </form>
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
    <article className={`memory-card ${state}`} aria-label={t('chat.memoryTitle')}>
      <section className="memory-observation">
        <p>
          {props.memory.observation}
        </p>
      </section>
      <section className="memory-reason">
        <small>
          {t('chat.why')}
        </small>
        <p>
          {props.memory.reason}
        </p>
      </section>
      <footer>
        <span role={state === 'failed' ? 'alert' : 'status'}>
          {state === 'saving' ? <ActivityDots /> : state === 'saved' ? <SuccessMark /> : null}
          {note}
        </span>
        {state === 'ready' ? <button type="button" onClick={() => void accept()}>
          {t('chat.remember')}
        </button> : null}
        {state === 'ready' ? <button
          type="button"
          onClick={() => { setState('rejected'); setNote(t('chat.ignoredMemory')) }}>
          {t('common.ignore')}
        </button> : null}
      </footer>
    </article>
  );
}

export function InitGuideCard(props: { state: 'explore' | 'interview'; busy: boolean; running: boolean; done: boolean; note: string; onStart(): void; onDismiss(): void }) {
  const explore = props.state === 'explore'
  return (
    <details className="init-guide-quiet" aria-label={t('chat.initQuietTitle')}>
      <summary>
        {t('chat.initQuietTitle')}
      </summary>
      <p>
        {explore ? t('chat.initExplore') : t('chat.initInterview')}
      </p>
      {props.done
        ? <p role="status">
        <SuccessMark />
        {' '}
        {t('chat.initDone')}
      </p>
        : <div className="init-guide-actions">
        <button
          type="button"
          disabled={props.busy || props.running}
          onClick={props.onStart}>
          {props.running ? <Fragment>
            <ActivityDots />
            {t('chat.initRunning')}
          </Fragment> : t('chat.initStart')}
        </button>
        <button type="button" disabled={props.busy} onClick={props.onDismiss}>
          {t('common.ignore')}
        </button>
      </div>}
      {props.note ? <small className="warning" role="alert">
        {props.note}
      </small> : null}
    </details>
  );
}

/** 旧版会话顶部的迁移横幅：新建写作会话继续作品，旧会话保持可读；关闭仅记忆在内存。 */
export function LegacyMigrationBanner(props: { onMigrate(): void; onDismiss(): void }) {
  return (
    <div
      className="migration-banner"
      role="note"
      aria-label={t('chat.legacyMigrationTitle')}>
      <p>
        {t('chat.legacyMigrationBanner')}
      </p>
      <div className="migration-banner-actions">
        <button type="button" onClick={props.onMigrate}>
          {t('chat.legacyMigrationAction')}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('common.close')}
          onClick={props.onDismiss}>
          ×
        </button>
      </div>
    </div>
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
    <details className="project-context-receipt">
      <summary>
        {`${t('chat.contextSummary', { included: includedFixed, total: fixed.length, worldbook: worldbook.length })}${receipt.authorPreferencesChars ? t('chat.contextAuthorPref', { count: receipt.authorPreferencesChars }) : ''}${receipt.authorMemoryChars ? t('chat.contextAuthorMemory', { count: receipt.authorMemoryChars }) : ''}`}
      </summary>
      <ul>
        {receipt.sources.map((item) => <li key={item.path}>
          <code>
            {item.path}
          </code>
          {` · ${item.status === 'included'
            ? item.includedChars > 0 ? t('chat.includedChars', { count: item.includedChars }) : item.truncated ? t('chat.notIncludedCap') : t('chat.emptyFile')
            : item.status === 'missing' ? t('chat.missingFile') : t('chat.readFailed')}`}
          {item.truncated ? t('chat.truncated') : ''}
          {item.kind === 'worldbook' ? t('chat.worldbookMatch', { priority: item.priority ?? 0, matched: `${matchedByText(item.matchedBy)}${item.matchedTriggers?.length ? ` (${item.matchedTriggers.join('、')})` : ''}` }) : ''}
          {item.version ? ` · ${item.version}` : ''}
        </li>)}
      </ul>
      {receipt.scan ? <p className="muted">
        {t('chat.worldbookScan', { scanned: receipt.scan.scanned, unmatched: receipt.scan.unmatched, disabled: receipt.scan.disabled, invalid: receipt.scan.invalid, limits: receipt.scan.limits, errors: receipt.scan.readErrors })}
      </p> : null}
    </details>
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
          {t('chat.thinkingProcess')}
        </summary>
        <p>
          {row.text}
        </p>
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
          {row.recovered ? row.text : `⚠ ${row.text}`}
        </summary>
        {row.reason ? <p className="tool-error-reason">
          {row.reason}
        </p> : null}
        {row.content ? <pre>
          {row.content}
        </pre> : null}
        {row.detail ? <small>
          {row.detail}
        </small> : null}
      </ChatEntry>
    );
  }
  if (row.role === 'tool' && row.content) {
    return (
      <ChatEntry as="details" className="chat-row tool" enter={props.enter}>
        <summary>
          {row.text}
        </summary>
        <pre>
          {row.content}
        </pre>
        {row.detail ? <small>
          {row.detail}
        </small> : null}
      </ChatEntry>
    );
  }
  return (
    <ChatEntry className={`chat-row ${row.role}`} enter={props.enter}>
      {row.role === 'assistant' && row.text
        ? <div className="md">
        <Markdown text={row.text} />
      </div>
        : <p>
        {row.text || t('chat.noText')}
      </p>}
      {row.detail ? <small>
        {row.detail}
      </small> : null}
      {row.projectContextReceipt ? <ProjectContextReceiptView receipt={row.projectContextReceipt} /> : null}
    </ChatEntry>
  );
})

/* 停止必须在 cancel 结算后松开 outgoing；拒绝或 RPC 失败也不能把发送闸门永久锁在 accepted。
   与 rows 对齐后的清场仍由 outgoingIsCanonical 负责，这里只覆盖显式停止。 */
