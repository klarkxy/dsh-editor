import { createElement as e, useEffect, useRef, useState, type RefObject, type ChangeEvent } from 'react'
import {
  CHAPTER_STATE_KEYS,
  CHAPTER_STATE_MAX_TOTAL_CHARS,
  applyChapterMeta,
  parseChapterMeta,
  validateChapterMeta,
  type ChapterStateFields,
} from 'dsh-editor-workbench/contracts'
import { t, type MessageKey } from '../i18n/index.ts'
import {
  beatsFromTextarea,
  beatsToTextarea,
  chapterMetaPatch,
  isChapterMetaPath,
  stateTotalChars,
} from '../chapter-meta-view.ts'
import { Button, Dialog } from './ui/index.ts'

const STATE_LABELS: Record<(typeof CHAPTER_STATE_KEYS)[number], MessageKey> = {
  now: 'chapterMeta.stateNow',
  where: 'chapterMeta.stateWhere',
  knows: 'chapterMeta.stateKnows',
  ended: 'chapterMeta.stateEnded',
  open: 'chapterMeta.stateOpen',
}

export { isChapterMetaPath }

export type ChapterMetaSettingsInput = {
  beats: string
  state: ChapterStateFields
}

export type ChapterMetaApplyResult =
  | { ok: true; text: string; note: string }
  | { ok: false; note: string }

function formFields(input: ChapterMetaSettingsInput) {
  const beats = beatsFromTextarea(input.beats)
  const state: ChapterStateFields = {}
  for (const key of CHAPTER_STATE_KEYS) {
    const value = (input.state[key] ?? '').split(/\r?\n/, 1)[0]?.trim() ?? ''
    if (value) state[key] = value
  }
  return {
    beats,
    state,
    fields: {
      ...(beats.length ? { beats } : {}),
      ...(CHAPTER_STATE_KEYS.some((key) => state[key]) ? { state } : {}),
    },
  }
}

export function applyChapterMetaSettings(text: string, input: ChapterMetaSettingsInput): ChapterMetaApplyResult {
  const current = parseChapterMeta(text)
  if (current === undefined) return { ok: false, note: t('chapterMeta.unclosed') }
  const { beats, state, fields } = formFields(input)
  const issues = validateChapterMeta(fields)
  if (issues.length) return { ok: false, note: issues.join('；') }
  const patch = chapterMetaPatch(current, { beats, state })
  if (!Object.keys(patch).length) return { ok: true, text, note: t('chapterMeta.unchanged') }
  try {
    return { ok: true, text: applyChapterMeta(text, patch), note: t('chapterMeta.addedDraft') }
  } catch (error) {
    return { ok: false, note: error instanceof Error ? error.message : t('chapterMeta.applyFailed') }
  }
}

/** 对话框各自只拥有一个字段：章纲对话框只写 beats，章末小结对话框只写 state。 */
export type ChapterMetaOwnedField = 'beats' | 'state'

export type ChapterMetaFieldValue = string | ChapterStateFields

/** 从当前文档解析出某个自有字段的表单初值，供每次打开对话框时重新取水。 */
export function chapterMetaFieldForm(text: string, field: ChapterMetaOwnedField): ChapterMetaFieldValue {
  const parsed = parseChapterMeta(text)
  if (field === 'beats') return beatsToTextarea(parsed?.beats)
  const state: ChapterStateFields = {}
  for (const key of CHAPTER_STATE_KEYS) state[key] = parsed?.state?.[key] ?? ''
  return state
}

/**
 * 只把自有字段的改动套到完整文档上：另一字段沿用文档现值，正文与其它 frontmatter 原样保留。
 * 清空自有字段表示移除该字段；与现值一致时原样返回并标记 unchanged。
 */
export function applyOwnedChapterMetaField(text: string, field: ChapterMetaOwnedField, value: ChapterMetaFieldValue): ChapterMetaApplyResult {
  const current = parseChapterMeta(text)
  if (current === undefined) return { ok: false, note: t('chapterMeta.unclosed') }
  const input: ChapterMetaSettingsInput = field === 'beats'
    ? { beats: typeof value === 'string' ? value : '', state: current.state ?? {} }
    : { beats: beatsToTextarea(current.beats), state: typeof value === 'string' ? {} : value }
  return applyChapterMetaSettings(text, input)
}

/**
 * 保存决策（可独立测试）：按最新缓冲区计算 owned-field 补丁。
 * - unchanged：与缓冲区一致且没有待重试的失败——直接关闭；
 * - save：需要写入；上一次失败后的同值重试（retryPending）也必须再次发起保存；
 * - error：校验/解析失败，保持打开并显示原因。
 */
export type ChapterMetaSavePlan =
  | { action: 'unchanged'; note: string }
  | { action: 'save'; next: string; note: string }
  | { action: 'error'; note: string }

export function chapterMetaSavePlan(
  text: string,
  field: ChapterMetaOwnedField,
  value: ChapterMetaFieldValue,
  retryPending: boolean,
): ChapterMetaSavePlan {
  const result = applyOwnedChapterMetaField(text, field, value)
  if (!result.ok) return { action: 'error', note: result.note }
  if (result.text !== text || retryPending) return { action: 'save', next: result.text, note: result.note }
  return { action: 'unchanged', note: result.note }
}

/** 编辑器当前章节的最新状态：text 是未保存的缓冲区（不是磁盘基准），path 用于身份校验。 */
export type ChapterMetaBuffer = { path: string; text: string }

function ChapterMetaDialog(props: {
  field: ChapterMetaOwnedField
  path: string
  open: boolean
  onOpenChange(open: boolean): void
  returnFocusRef?: RefObject<HTMLElement | null>
  /** 读取编辑器当前章节的最新缓冲区；文档未载入或路径不一致时返回 null。 */
  readBuffer(): ChapterMetaBuffer | null
  /** 统一元数据写入通道（EditorCore.saveMetadataText）：真实 file.write 回执；失败时对话框保持打开。 */
  saveMetadata(next: string): Promise<{ ok: boolean; note: string }>
  onNote(note: string): void
}) {
  const field = props.field
  const title = t(field === 'beats' ? 'chapterMeta.planTitle' : 'chapterMeta.summaryTitle')
  const hint = t(field === 'beats' ? 'chapterMeta.planHint' : 'chapterMeta.summaryHint')
  const focusRef = useRef<HTMLElement | null>(null)
  const [beats, setBeats] = useState('')
  const [state, setState] = useState<ChapterStateFields>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /* 打开代次：打开时 +1 并按最新缓冲区取水；关闭与卸载时再 +1 作废旧一代——
     旧的一次性异步结果不得把新对话框关掉，也不得在关闭后回调宿主。 */
  const openGeneration = useRef(0)
  /* 上一次写入失败后保留输入与缓冲区编辑；同值重试仍会真正发起保存。 */
  const [retryPending, setRetryPending] = useState(false)

  /* 每次打开都按当前缓冲区重新取水；取消/关闭不保留上次未保存的编辑。 */
  useEffect(() => {
    openGeneration.current += 1
    if (!props.open) return
    const buffer = props.readBuffer()
    if (!buffer || buffer.path !== props.path) {
      setBeats('')
      setState({})
      setError(t('chapterMeta.notLoaded'))
      setBusy(false)
      setRetryPending(false)
      return
    }
    const value = chapterMetaFieldForm(buffer.text, field)
    if (typeof value === 'string') {
      setBeats(value)
      setState({})
    } else {
      setBeats('')
      setState(value)
    }
    setError(parseChapterMeta(buffer.text) === undefined ? t('chapterMeta.unclosed') : '')
    setBusy(false)
    setRetryPending(false)
    /* field/path 由组件 key 保证稳定；open 翻转是唯一的重新取水时机。 */
  }, [props.open])

  /* 卸载同样作废旧代次：组件消失后到达的回执不得再触达 onNote/onOpenChange。 */
  useEffect(() => () => { openGeneration.current += 1 }, [])

  const buffer = props.readBuffer()
  const valid = Boolean(buffer && buffer.path === props.path && parseChapterMeta(buffer.text) !== undefined)
  const form = formFields({ beats, state })
  const issues = valid ? validateChapterMeta(form.fields) : []
  const used = stateTotalChars(state)
  const disabled = !valid || issues.length > 0 || busy

  const apply = async () => {
    if (busy) return
    const latest = props.readBuffer()
    /* 会话/路径/文档身份守卫：文档已切换时不写，避免把字段写进别的文件。 */
    if (!latest || latest.path !== props.path) {
      setError(t('chapterMeta.moved'))
      return
    }
    const plan = chapterMetaSavePlan(latest.text, field, field === 'beats' ? beats : state, retryPending)
    if (plan.action === 'error') { setError(plan.note); return }
    if (plan.action === 'unchanged') {
      props.onNote(plan.note)
      props.onOpenChange(false)
      return
    }
    const generation = openGeneration.current
    setBusy(true)
    try {
      /* 等真正的写入回执：成功才关闭；失败保持打开、保留输入并可重试。 */
      const ack = await props.saveMetadata(plan.next)
      if (generation !== openGeneration.current) return
      props.onNote(ack.note)
      if (ack.ok) {
        setRetryPending(false)
        props.onOpenChange(false)
      } else {
        setRetryPending(true)
        setError(ack.note)
      }
    } catch {
      if (generation !== openGeneration.current) return
      setRetryPending(true)
      setError(t('chapterMeta.applyFailed'))
    } finally {
      if (generation === openGeneration.current) setBusy(false)
    }
  }

  const setField = (key: (typeof CHAPTER_STATE_KEYS)[number], value: string) => {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  /* 可见标题/说明由 Dialog 的 title/description 提供（供辅助技术朗读），
     这里不再重复渲染第二套可见 heading/hint。 */
  return e(Dialog, {
    open: props.open,
    onOpenChange: props.onOpenChange,
    title,
    description: hint,
    className: 'file-dialog editor-action-dialog chapter-meta-settings',
    initialFocusRef: focusRef,
    returnFocusRef: props.returnFocusRef,
  },
    e('div', { className: 'chapter-meta-body' },
      field === 'beats'
        ? e('label', null,
            e('span', null, t('chapterMeta.beats')),
            e('small', null, t('chapterMeta.beatsHint')),
            e('textarea', {
              ref: focusRef,
              value: beats,
              disabled: !valid,
              rows: Math.min(8, Math.max(3, beats.split(/\r?\n/).length)),
              onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { setBeats(event.target.value); setError('') },
              'aria-label': t('chapterMeta.beatsAria'),
            }),
          )
        : e('div', { className: 'chapter-meta-state', 'aria-label': t('chapterMeta.state') },
            ...CHAPTER_STATE_KEYS.map((key) => e('label', { key },
              e('span', null, t(STATE_LABELS[key])),
              e('input', {
                type: 'text',
                value: state[key] ?? '',
                disabled: !valid,
                onChange: (event: ChangeEvent<HTMLInputElement>) => { setField(key, event.target.value); setError('') },
                'aria-label': t(STATE_LABELS[key]),
              }),
            )),
          ),
      field === 'state'
        ? e('small', {
            className: used > CHAPTER_STATE_MAX_TOTAL_CHARS ? 'chapter-meta-count over' : 'chapter-meta-count',
          }, t('chapterMeta.stateCount', { used, max: CHAPTER_STATE_MAX_TOTAL_CHARS }))
        : null,
      issues.length ? e('span', { className: 'warning', role: 'alert' }, issues.join('；')) : null,
      error && !issues.length ? e('span', { className: 'warning', role: 'alert' }, error) : null,
    ),
    e('footer', null,
      e(Button, { onClick: () => props.onOpenChange(false) }, t('common.cancel')),
      e(Button, { variant: 'primary', onClick: () => void apply(), disabled }, busy ? t('chapterMeta.saving') : t('chapterMeta.apply')),
    ),
  )
}

export { ChapterMetaDialog }

/** 稿纸旁的紧凑章纲条：默认只显示一行摘要，展开后列出当前章纲节拍。 */
export function ChapterPlanStrip(props: { text: string }) {
  const beats = (parseChapterMeta(props.text)?.beats ?? []).map((beat) => beat.trim()).filter(Boolean)
  return e('details', { className: 'chapter-meta-settings chapter-plan-strip' },
    e('summary', { 'aria-label': t('chapterMeta.toggle') },
      e('span', { className: 'chapter-plan-strip-label' },
        beats.length ? t('chapterMeta.stripSummary', { count: beats.length }) : t('chapterMeta.stripEmpty'))),
    beats.length ? e('ol', { className: 'chapter-plan-beats' },
      beats.map((beat, index) => e('li', { key: index }, beat))) : null,
  )
}
