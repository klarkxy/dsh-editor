import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

export type FrozenPrompt = { assembly: PromptAssembly; fingerprint: string }

const FROZEN_LIMIT = 100

const frozen = new Map<string, FrozenPrompt>()

export function frozenPromptFor(sessionId: string): FrozenPrompt | undefined {
  return frozen.get(sessionId)
}

export function freezePrompt(sessionId: string, assembly: PromptAssembly, fingerprint: string): FrozenPrompt {
  const entry = { assembly, fingerprint }
  frozen.delete(sessionId)
  frozen.set(sessionId, entry)
  while (frozen.size > FROZEN_LIMIT) frozen.delete(frozen.keys().next().value as string)
  return entry
}

export function discardFrozenPrompt(sessionId: string): void {
  frozen.delete(sessionId)
}

export function promptFingerprint(preferences: string, limitBreak: boolean): string {
  const text = `${limitBreak ? '1' : '0'}${preferences}`
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
