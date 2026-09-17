import { useEffect } from 'react'
import { isSuccessWorkbenchNote, TRANSIENT_STATUS_NOTE_MS } from './shared.ts'

export function useTransientSuccessNote(note: string, onExpire: (note: string) => void) {
  useEffect(() => {
    if (!note || !isSuccessWorkbenchNote(note)) return
    const timer = globalThis.setTimeout(() => onExpire(note), TRANSIENT_STATUS_NOTE_MS)
    return () => globalThis.clearTimeout(timer)
  }, [note, onExpire])
}
