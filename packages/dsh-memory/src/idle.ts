export function shouldRunIdleDream(input: {
  dreamIdleEnabled: boolean
  pluginActive: boolean
  agentIdle: boolean
  dreamRunning: boolean
  lastActivityAt: number
  now: number
  idleMs: number
}): boolean {
  if (!input.dreamIdleEnabled || !input.pluginActive || !input.agentIdle || input.dreamRunning) return false
  return input.now - input.lastActivityAt >= input.idleMs
}

export function nextIdleDeadline(idleAt: number, idleMs: number): number {
  return idleAt + idleMs
}
