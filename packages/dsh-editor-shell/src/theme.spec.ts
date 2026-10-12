import { describe, expect, it, vi } from 'vitest'
import {
  LEGACY_ACCENT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  decodeHostThemePreference,
  hostPreferenceToTheme,
  readInitialTheme,
  themeToHostPreference,
  writeHostThemePreference,
  type HostThemePreference,
  type HostThemeScope,
} from './model/theme.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value },
    data,
  }
}

describe('host theme preference mapping', () => {
  it('maps light/dark onto the host light/dark pair', () => {
    expect(themeToHostPreference('light')).toBe('light')
    expect(themeToHostPreference('dark')).toBe('dark')
    expect(hostPreferenceToTheme('light')).toBe('light')
    expect(hostPreferenceToTheme('dark')).toBe('dark')
  })

  it('resolves the host system preference without matchMedia to light', () => {
    // Vitest runs in node: no matchMedia, so system falls back to the light default.
    expect(hostPreferenceToTheme('system')).toBe('light')
  })

  it('decodes only the supported preference values', () => {
    expect(decodeHostThemePreference({ preference: 'light' })).toEqual({ preference: 'light' })
    expect(decodeHostThemePreference({ preference: 'dark' })).toEqual({ preference: 'dark' })
    expect(decodeHostThemePreference({ preference: 'system' })).toEqual({ preference: 'system' })
    expect(decodeHostThemePreference({ preference: 'sepia' })).toBeUndefined()
    expect(decodeHostThemePreference({})).toBeUndefined()
    expect(decodeHostThemePreference(null)).toBeUndefined()
    expect(decodeHostThemePreference('dark')).toBeUndefined()
  })
})

describe('host theme preference write-through', () => {
  function fakeScope(initial: { writable?: boolean; value?: { preference: HostThemePreference } }) {
    const state = { ...initial, listeners: new Set<() => void>(), writes: [] as HostThemePreference[] }
    const scope: HostThemeScope = {
      getSnapshot: () => ({ writable: state.writable, value: state.value }),
      set: (_field, value) => {
        state.writes.push(value)
        state.value = { preference: value }
        for (const listener of [...state.listeners]) listener()
        return Promise.resolve()
      },
      subscribe: (listener) => {
        state.listeners.add(listener)
        return () => state.listeners.delete(listener)
      },
    }
    const load = (value: { preference: HostThemePreference }) => {
      state.writable = true
      state.value = value
      for (const listener of [...state.listeners]) listener()
    }
    return { state, scope, load }
  }

  it('writes immediately when the scope is loaded and disagrees', () => {
    const { state, scope } = fakeScope({ writable: true, value: { preference: 'system' } })
    writeHostThemePreference(scope, 'dark')
    expect(state.writes).toEqual(['dark'])
    expect(state.listeners.size).toBe(0)
  })

  it('skips the write when the host already agrees', () => {
    const { state, scope } = fakeScope({ writable: true, value: { preference: 'dark' } })
    writeHostThemePreference(scope, 'dark')
    expect(state.writes).toEqual([])
    expect(state.listeners.size).toBe(0)
  })

  it('defers the write until the settings document finishes loading', () => {
    const { state, scope, load } = fakeScope({ writable: false, value: undefined })
    writeHostThemePreference(scope, 'dark')
    expect(state.writes).toEqual([])
    expect(state.listeners.size).toBe(1)
    load({ preference: 'system' })
    expect(state.writes).toEqual(['dark'])
    expect(state.listeners.size).toBe(0)
  })

  it('does not write to a read-only scope, even after updates', () => {
    const { state, scope } = fakeScope({ writable: false, value: { preference: 'system' } })
    writeHostThemePreference(scope, 'dark')
    expect(state.writes).toEqual([])
    state.value = { preference: 'light' }
    for (const listener of [...state.listeners]) listener()
    expect(state.writes).toEqual([])
  })

  it('survives the load landing between the first check and the subscription', () => {
    // The scope finishes loading exactly while the retry subscription is
    // being registered; with subscribe-before-attempt ordering the write
    // must still land instead of being stranded without further events.
    const { state, scope, load } = fakeScope({ writable: false, value: undefined })
    const replaying: HostThemeScope = {
      ...scope,
      subscribe: (listener) => {
        const dispose = scope.subscribe(listener)
        load({ preference: 'system' })
        return dispose
      },
    }
    writeHostThemePreference(replaying, 'dark')
    expect(state.writes).toEqual(['dark'])
    expect(state.listeners.size).toBe(0)
  })

  it('returns the actual write receipt and propagates rejection, including undefined', async () => {
    const { scope } = fakeScope({ writable: true, value: { preference: 'light' } })
    let complete!: (value: unknown) => void
    const held = { ...scope, set: () => new Promise(resolve => { complete = resolve }) }
    let settled = false
    const receipt = writeHostThemePreference(held, 'dark').then(value => { settled = true; return value })
    await Promise.resolve()
    expect(settled).toBe(false)
    complete('saved')
    await expect(receipt).resolves.toBe('saved')
    await expect(writeHostThemePreference({ ...scope, set: () => Promise.reject(undefined) }, 'dark')).rejects.toBeUndefined()
  })

  it('cancels a queued loading write without writing when that old scope later loads', async () => {
    const { state, scope, load } = fakeScope({ writable: false, value: undefined })
    const controller = new AbortController()
    const receipt = writeHostThemePreference(scope, 'dark', controller.signal)
    expect(state.listeners.size).toBe(1)
    controller.abort()
    await expect(receipt).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.listeners.size).toBe(0)
    load({ preference: 'light' })
    expect(state.writes).toEqual([])
  })

  it('does not subscribe or write for an already cancelled caller', async () => {
    const { state, scope } = fakeScope({ writable: true, value: { preference: 'light' } })
    const controller = new AbortController()
    controller.abort()
    await expect(writeHostThemePreference(scope, 'dark', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.listeners.size).toBe(0)
    expect(state.writes).toEqual([])
  })
})

describe('legacy theme and accent migration', () => {
  it('reads stored light/dark without rewriting them', () => {
    const light = memoryStorage({ [THEME_STORAGE_KEY]: 'light' })
    expect(readInitialTheme(light)).toBe('light')
    expect(light.data[THEME_STORAGE_KEY]).toBe('light')
    const dark = memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })
    expect(readInitialTheme(dark)).toBe('dark')
    expect(dark.data[THEME_STORAGE_KEY]).toBe('dark')
  })

  it('migrates stored paper/ink onto light/dark and persists the new value', () => {
    const paper = memoryStorage({ [THEME_STORAGE_KEY]: 'paper' })
    expect(readInitialTheme(paper)).toBe('light')
    expect(paper.data[THEME_STORAGE_KEY]).toBe('light')
    const ink = memoryStorage({ [THEME_STORAGE_KEY]: 'ink' })
    expect(readInitialTheme(ink)).toBe('dark')
    expect(ink.data[THEME_STORAGE_KEY]).toBe('dark')
  })

  it('leaves a stored legacy accent key untouched (C43)', async () => {
    // G1 决策 3：自选主题色已删除；作者保存过的值不读、不迁移、不删。
    vi.resetModules()
    const storage = memoryStorage({ [LEGACY_ACCENT_STORAGE_KEY]: 'pine' })
    vi.stubGlobal('localStorage', storage)
    try {
      await import('./client/theme.tsx')
      await import('./model/theme.ts')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(storage.data[LEGACY_ACCENT_STORAGE_KEY]).toBe('pine')
  }, 20000)
})
