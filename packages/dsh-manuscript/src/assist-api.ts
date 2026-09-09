/** Narrow optional completion service; the manuscript channel remains the sole RPC owner. */
export type ManuscriptAssist = {
  complete(endpoint: 'fim.complete' | 'patch.complete', body: Record<string, unknown>, route: { provider: string; model: string }, signal: AbortSignal): Promise<{ text: string; route: 'dsh-llm' }>
  summary(days: unknown): Promise<{ days: unknown[] }>
}
