export type TriggerKind = 'skip' | 'clear' | 'mild' | 'material' | 'risk'
export type MoodMode = 'auto' | 'manual' | 'strict'

const ACK = /^(好的?|嗯+|行|ok|okay|收到|谢谢[.。!！]?|thanks[.!]?)$/i
const CONTINUE = /^(继续|接着(?:做|写|改)?|go on|continue)$/i
const VAGUE = /帮我(?:看|改|写|弄)?一下|改一下|写一下|处理一下|优化一下|弄好|随便|看情况|你决定|都行|无所谓|或者就|怎么写都行|看着办|帮我改改|改改/
const RISK = /删除全部|全部删除|清空(?:全书|所有|全部)?|覆盖原文|覆盖所有|重写全|全部重写|并发布|发布到|永久删除|替换所有/
const PATH = /\.[A-Za-z][A-Za-z0-9]{0,7}\b|第[一二三四五六七八九十百0-9]+章|[A-Za-z]:\\|\//
const BOUND = /不超过|不少于|至少|最多|保持|不要|仅|只|必须|字以内|<=|≥|\d+\s*(?:字|句|段|行)/
const NAMED = /[\u4e00-\u9fff]{2,6}(?:的)?(?:对白|对话|语气|出场)|“[^”]{2,40}”/
const EXPLAIN = /解释什么是|^什么是|explain\s+what/i
const TRANSLATE = /翻译成|译成|translate\s+.+\s+into/i
const LOCAL_EDIT = /把第[一二三四五六七八九十百0-9]+[行句段]|修正拼写|重命名为|把错字|typo/i

export function classifyRequest(text: string, options: { hasConfirmedContract?: boolean } = {}): TriggerKind {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return 'skip'
  if (ACK.test(trimmed)) return 'skip'
  if (CONTINUE.test(trimmed)) return options.hasConfirmedContract ? 'skip' : 'material'
  if (RISK.test(trimmed)) return 'risk'
  if (EXPLAIN.test(trimmed) || TRANSLATE.test(trimmed) || LOCAL_EDIT.test(trimmed)) return 'clear'
  if (VAGUE.test(trimmed)) return 'material'
  const specific = PATH.test(trimmed) || NAMED.test(trimmed)
  const bounded = BOUND.test(trimmed)
  if (specific && bounded && trimmed.length >= 16) return 'clear'
  if (specific || bounded) return 'mild'
  return 'clear'
}

export function shouldAnalyze(kind: TriggerKind, mode: MoodMode, pendingManual: boolean): boolean {
  if (kind === 'skip') return false
  if (pendingManual) return true
  if (mode === 'manual') return false
  if (mode === 'strict') return true
  return kind === 'material' || kind === 'risk'
}

export function shouldWriteClearContract(kind: TriggerKind, pendingManual: boolean, mode: MoodMode = 'auto'): boolean {
  return kind === 'clear' && !pendingManual && mode === 'auto'
}

export function isBlockingKind(kind: TriggerKind): boolean {
  return kind === 'material' || kind === 'risk'
}
