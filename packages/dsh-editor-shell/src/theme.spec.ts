import { describe, expect, it } from 'vitest'
import {
  decodeHostThemePreference,
  hostPreferenceToTheme,
  themeToHostPreference,
  writeHostThemePreference,
  type HostThemePreference,
  type HostThemeScope,
} from './client/theme.ts'

describe('host theme preference mapping', () => {
  it('maps paper/ink onto the host light/dark pair', () => {
    expect(themeToHostPreference('paper')).toBe('light')
    expect(themeToHostPreference('ink')).toBe('dark')
    expect(hostPreferenceToTheme('light')).toBe('paper')
    expect(hostPreferenceToTheme('dark')).toBe('ink')
  })

  it('resolves the host system preference without matchMedia to paper', () => {
    // Vitest runs in node: no matchMedia, so system falls back to the light default.
    expect(hostPreferenceToTheme('system')).toBe('paper')
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
})
