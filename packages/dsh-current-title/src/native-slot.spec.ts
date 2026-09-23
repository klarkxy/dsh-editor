import { describe, expect, it } from 'vitest'
import { PROVIDER_ID } from './contracts.ts'
import {
  captureDisplacement, createNativeTitleSlot, displacementUnchanged, entryDisabled, findLoaderEntry,
  restoreOwnDisplacement, type LoaderEntry, type LoaderFace, type SessionTitleServiceLike,
} from './native-slot.ts'

/** Mirrors DSH 0.1.7-alpha.1 SessionTitleService.register exclusivity (no extra error stack fields). */
function nativeExclusive(initial?: string) {
  let registration: { id: string } | undefined = initial ? { id: initial } : undefined
  const active = new Set<Promise<unknown>>()
  return {
    occupant: () => registration?.id,
    hold(work: Promise<unknown>) {
      active.add(work)
      void work.finally(() => active.delete(work))
    },
    async drop(id: string) {
      if (registration?.id !== id) return
      await Promise.allSettled([...active])
      if (registration?.id === id) registration = undefined
    },
    register(provider: { id: string }) {
      if (registration !== undefined) {
        throw new Error(`session-title provider "${registration.id}" is already registered`)
      }
      const current = { id: provider.id }
      registration = current
      return async () => {
        await Promise.allSettled([...active])
        if (registration === current) registration = undefined
      }
    },
  }
}

function loader(
  rows: LoaderEntry[],
  exclusive?: ReturnType<typeof nativeExclusive>,
  occupantId = 'session-title-first-prompt-llm',
): LoaderFace & { rows: LoaderEntry[]; updates: Array<{ id: string; disabled?: boolean | null }> } {
  const updates: Array<{ id: string; disabled?: boolean | null }> = []
  return {
    rows,
    updates,
    entries: () => rows,
    async update(id, options) {
      updates.push({ id, disabled: options.disabled })
      const entry = rows.find(item => item.id === id)
      if (entry) entry.options = { ...entry.options, ...options }
      if (!exclusive || id !== 'session-title-llm') return
      if (options.disabled === true) await exclusive.drop(occupantId)
      else if (options.disabled === false && exclusive.occupant() === undefined) {
        exclusive.register({ id: occupantId })
      }
    },
  }
}

const firstPrompt: LoaderEntry = {
  id: 'session-title-llm',
  options: { name: '@deepseek-ai/dsh-session-title-first-prompt-llm', disabled: false, config: { targetWords: 5 } },
}

describe('native title occupancy', () => {
  it('captures the displaced loader identity and restores it only while unchanged', async () => {
    const exclusive = nativeExclusive('session-title-first-prompt-llm')
    const host = loader([{ ...firstPrompt, options: { ...firstPrompt.options } }], exclusive)
    const slot = createNativeTitleSlot({
      sessionTitle: exclusive as unknown as SessionTitleServiceLike,
      loader: host,
      generate: async () => ({ title: 't', messageSeqs: [] }),
    })
    const dispose = await slot.occupy(PROVIDER_ID)
    expect(exclusive.occupant()).toBe(PROVIDER_ID)
    expect(entryDisabled(host.rows[0]!)).toBe(true)
    expect(slot.displacement).toEqual(captureDisplacement({
      id: 'session-title-llm',
      options: { name: '@deepseek-ai/dsh-session-title-first-prompt-llm', disabled: false, config: { targetWords: 5 } },
    }))
    await dispose()
    expect(exclusive.occupant()).toBeUndefined()
    expect(await restoreOwnDisplacement(host, slot.displacement)).toBe('restored')
    expect(host.rows[0]?.options?.disabled).toBe(false)
    expect(exclusive.occupant()).toBe('session-title-first-prompt-llm')
  })

  it('does not re-enable a user-disabled first-prompt entry', async () => {
    const exclusive = nativeExclusive('session-title-first-prompt-llm')
    const host = loader([{
      id: 'session-title-llm',
      options: { name: '@deepseek-ai/dsh-session-title-first-prompt-llm', disabled: true },
    }])
    const slot = createNativeTitleSlot({
      sessionTitle: exclusive as unknown as SessionTitleServiceLike,
      loader: host,
      generate: async () => ({ title: 't', messageSeqs: [] }),
    })
    await expect(slot.occupy(PROVIDER_ID)).rejects.toThrow(/already registered/)
    expect(host.updates).toEqual([])
    expect(slot.displacement).toBeUndefined()
  })

  it('does not restore after a third-party options replacement and never touches an unrelated provider', async () => {
    const exclusive = nativeExclusive('session-title-first-prompt-llm')
    const other: LoaderEntry = { id: 'other-title', options: { name: 'other-title-plugin', disabled: true } }
    const host = loader([{ ...firstPrompt, options: { ...firstPrompt.options } }, other], exclusive)
    const slot = createNativeTitleSlot({
      sessionTitle: exclusive as unknown as SessionTitleServiceLike,
      loader: host,
      generate: async () => ({ title: 't', messageSeqs: [] }),
    })
    await slot.occupy(PROVIDER_ID)
    const snapshot = slot.displacement!
    host.rows[0]!.options = { name: 'third-party-title', disabled: true, config: { targetWords: 9 } }
    expect(displacementUnchanged(snapshot, host.rows[0]!)).toBe(false)
    expect(await restoreOwnDisplacement(host, snapshot)).toBe('skipped')
    expect(host.updates.every(item => item.id !== 'other-title')).toBe(true)
    expect(other.options?.disabled).toBe(true)
  })

  it('maps the native first-prompt occupant onto the session-title-llm loader row', () => {
    const host = loader([firstPrompt])
    expect(findLoaderEntry(host, 'session-title-first-prompt-llm')?.id).toBe('session-title-llm')
  })

  it('awaits in-flight native register work before the disposer settles', async () => {
    const exclusive = nativeExclusive()
    let released = false
    let resume!: () => void
    const held = new Promise<void>(resolve => { resume = resolve })
    exclusive.hold(held.then(() => { released = true }))
    const slot = createNativeTitleSlot({
      sessionTitle: exclusive as unknown as SessionTitleServiceLike,
      loader: loader([]),
      generate: async () => ({ title: 't', messageSeqs: [] }),
    })
    const dispose = await slot.occupy(PROVIDER_ID)
    const pending = dispose()
    await Promise.resolve()
    expect(released).toBe(false)
    resume()
    await pending
    expect(released).toBe(true)
    expect(exclusive.occupant()).toBeUndefined()
  })
})
