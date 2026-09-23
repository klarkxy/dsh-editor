import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

export interface NativeSurfaceClient {
  sessions: {
    binding?(sessionId: string): { eventSource: { subscribe(listener: () => void): () => void } } | undefined
  }
  uiWorkspace: { current?: { getSnapshot(): { sessionId: string } | undefined; subscribe(listener: () => void): () => void } }
  uiSession: { adapter: { current: { getSnapshot(): { key?: string }; subscribe(listener: () => void): () => void } } }
  locale: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  connection?: { generation?: { subscribe(listener: () => void): () => void } }
}

/** The Editor retains its manuscript session separately; native DSH exposes the main-view binding. */
export function selectedSessionId(client: Pick<NativeSurfaceClient, 'uiWorkspace' | 'uiSession'>): string {
  return client.uiWorkspace.current
    ? client.uiWorkspace.current.getSnapshot()?.sessionId ?? ''
    : client.uiSession.adapter.current.getSnapshot().key ?? ''
}

/** Owner props win; native settings only supplies close, so resolve its selected session. */
export function useNativeSeat(client: NativeSurfaceClient, props: unknown) {
  const current = useSyncExternalStore(
    useCallback((fn: () => void) => (client.uiWorkspace.current ?? client.uiSession.adapter.current).subscribe(fn), [client]),
    useCallback(() => selectedSessionId(client), [client]),
    () => '',
  )
  const language = useSyncExternalStore(
    useCallback((fn: () => void) => client.locale.subscribe(fn), [client]),
    useCallback(() => client.locale.getSnapshot().active, [client]),
    () => 'en',
  )
  const row = props && typeof props === 'object' ? props as Record<string, unknown> : {}
  const owner = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : {}
  const sessionId = typeof row.sessionId === 'string' ? row.sessionId
    : typeof owner.sessionId === 'string' ? owner.sessionId : current
  const requestedLocale = row.locale ?? owner.locale ?? language
  return { sessionId, locale: (String(requestedLocale).startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en',
    hidden: row.hidden === true || owner.hidden === true }
}

/** Refresh on native log boundaries/reconnect/focus. Read-only settling is bounded to an observed job. */
export function useFeatureRefresh(
  client: NativeSurfaceClient, sessionId: string, refresh: () => void,
  working = false, enabled = true,
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const queue = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      clearTimeout(timer)
      timer = setTimeout(() => refreshRef.current(), 150)
    }
    const source = sessionId ? client.sessions.binding?.(sessionId)?.eventSource : undefined
    const stopEvents = source?.subscribe(queue)
    const stopConnection = client.connection?.generation?.subscribe(queue)
    const visibility = () => { if (document.visibilityState === 'visible') queue() }
    window.addEventListener('focus', queue)
    document.addEventListener('visibilitychange', visibility)
    // Details are collapsed by default; opening an existing panel must get current state.
    document.addEventListener('toggle', queue, true)
    return () => {
      clearTimeout(timer)
      stopEvents?.(); stopConnection?.()
      window.removeEventListener('focus', queue)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('toggle', queue, true)
    }
  }, [client, sessionId, enabled])
  useEffect(() => {
    if (!enabled || !working) return
    let delay = 250
    const until = Date.now() + 300_000
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (Date.now() >= until) return
      if (document.visibilityState !== 'hidden') refreshRef.current()
      delay = Math.min(delay * 2, 2000)
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, delay)
    return () => clearTimeout(timer)
  }, [client, sessionId, working, enabled])
}
