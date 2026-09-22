import {
  MAX_CARD_BODY_CHARS,
  RECAP_DISPLAY_PURPOSE,
  type RecapCard,
  type RecapFacts,
  type RecapTrigger,
} from './contracts.ts'
import { deterministicBody, deterministicReceiptsSuffice, deterministicTitle, isLongTask } from './log.ts'

export function shouldOfferTurnRecap(facts: RecapFacts, cardsEnabled: boolean): boolean {
  return cardsEnabled && facts.sourceStatus !== 'running' && isLongTask(facts)
}

export function shouldOfferIdleRecap(facts: RecapFacts, cardsEnabled: boolean, alreadyHasWatermark: boolean): boolean {
  return cardsEnabled && !alreadyHasWatermark && facts.toSeq >= 0 && facts.sourceVersion.length > 0
}

export function cardForFacts(
  facts: RecapFacts,
  input: { id: string; trigger: RecapTrigger; now: number; kind?: RecapCard['kind']; body?: string; generation?: RecapCard['generation'] },
): RecapCard {
  const sourceStatus = facts.sourceStatus === 'running' ? 'completed' : facts.sourceStatus
  const body = (input.body ?? deterministicBody(facts)).slice(0, MAX_CARD_BODY_CHARS)
  return {
    id: input.id,
    sessionId: facts.sessionId,
    sourceVersion: facts.sourceVersion,
    fromSeq: facts.fromSeq,
    toSeq: facts.toSeq,
    trigger: input.trigger,
    sourceStatus,
    title: deterministicTitle({ ...facts, sourceStatus }),
    body,
    kind: input.kind ?? 'deterministic',
    generation: input.generation ?? 'idle',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function recapDisplayRequest(facts: RecapFacts, cardId: string): { purpose: string; system: string; input: string; sourceVersion: string; sessionId: string } {
  return {
    purpose: RECAP_DISPLAY_PURPOSE,
    sessionId: facts.sessionId,
    sourceVersion: facts.sourceVersion,
    system: '根据给定事实写一段简短回顾，供作者阅读。不要把工具提案写成已经写入。不要编造未给出的结果。回顾不是模型上下文。',
    input: JSON.stringify({
      cardId,
      status: facts.sourceStatus,
      userTurns: facts.userTurns,
      tools: facts.tools.map(tool => ({
        name: tool.name,
        proposedChange: tool.proposedChange,
        error: tool.error,
      })),
      constraints: facts.constraints,
      lastUserExcerpt: facts.lastUserExcerpt,
    }),
  }
}

export function shouldGenerateRecap(facts: RecapFacts, trigger: RecapTrigger): boolean {
  if (trigger === 'retry' || trigger === 'manual') return true
  if (deterministicReceiptsSuffice(facts)) return false
  if (trigger === 'idle-return') return true
  return isLongTask(facts)
}

export function applyGeneratedText(card: RecapCard, text: string, receiptId: string | undefined, now: number): RecapCard {
  const trimmed = text.trim()
  if (!trimmed) return { ...card, kind: 'deterministic', generation: 'failed', updatedAt: now }
  return {
    ...card,
    body: trimmed.slice(0, MAX_CARD_BODY_CHARS),
    kind: 'generated',
    generation: 'idle',
    receiptId,
    updatedAt: now,
  }
}

export function existingCardForWatermark(cards: readonly RecapCard[], sessionId: string, sourceVersion: string): RecapCard | undefined {
  return cards.find(card => card.sessionId === sessionId && card.sourceVersion === sourceVersion)
}
