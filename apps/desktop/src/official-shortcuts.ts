import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ShortcutPersistence, bindingKey, effectiveShortcuts, parseShortcutDefinitions,
  parseShortcutEdit,
  type DesktopShortcutInput, type ShortcutConfigSnapshot, type ShortcutDefinition,
  type ShortcutPlatform, type ShortcutRevision,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { assertTrustedIpcSender, type IpcTrustInput } from './ipc-trust.js'

type Input = {
  type: string; key: string; code?: string
  control: boolean; alt: boolean; shift: boolean; meta: boolean
  isAutoRepeat?: boolean; isComposing?: boolean; modifiers?: readonly string[]
}
type Window = {
  close(): void
  on(event: 'blur' | 'focus' | 'closed', listener: () => void): unknown
  webContents: {
    on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: Input) => void): unknown
    on(event: 'did-start-navigation', listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): unknown
    focusedFrame?: { name: string; parent: unknown } | null
    send(channel: string, payload: unknown): void
    isDestroyed(): boolean
  }
}
type Event = { sender: unknown; senderFrame?: unknown }
type Ipc = { handle(channel: string, handler: (event: Event, ...args: unknown[]) => unknown): void }

export interface OfficialShortcutsDeps {
  ipc: Ipc
  userDataPath: string
  platform: ShortcutPlatform
  fromWebContents(sender: unknown): Window | undefined
  senderTrust(event: Event): IpcTrustInput
}

type WindowState = {
  persistence: ShortcutPersistence
  definitions: readonly ShortcutDefinition[] | null
  snapshot: ShortcutConfigSnapshot | null
  recording: boolean
  held: Set<string>
  owned: Set<string>
}

/** The official protocol owns validation and preference semantics; this adapter owns only Electron IO. */
export function installOfficialShortcuts(deps: OfficialShortcutsDeps): { attach(window: Window): void } {
  const states = new Map<Window, WindowState>()
  const path = join(deps.userDataPath, 'keybindings.json')
  let editQueue: Promise<unknown> = Promise.resolve()
  const storage = {
    async read() {
      try { return await readFile(path, 'utf8') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async write(raw: string) {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, raw, { encoding: 'utf8', flag: 'wx' })
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    },
  }

  function current(event: Event): { window: Window; state: WindowState } {
    assertTrustedIpcSender(deps.senderTrust(event), 'shortcuts')
    const window = deps.fromWebContents(event.sender)
    const state = window && states.get(window)
    if (!window || !state || window.webContents.isDestroyed()) throw new Error('shortcuts window unavailable')
    return { window, state }
  }

  deps.ipc.handle('dsh-shortcuts:get', async (event, value) => {
    const { state } = current(event)
    const definitions = parseShortcutDefinitions(value)
    state.definitions = definitions
    state.held.clear()
    state.owned.clear()
    state.persistence.setDefinitions(definitions)
    return state.persistence.readCurrent()
  })
  deps.ipc.handle('dsh-shortcuts:edit', (event, value, revision) => {
    const { window, state } = current(event)
    const edit = parseShortcutEdit(value)
    if (typeof revision !== 'string') throw new Error('Invalid shortcut revision')
    const run = async () => {
      if (states.get(window) !== state || state.definitions === null) throw new Error('shortcuts window unavailable')
      const result = await state.persistence.edit(edit, revision as ShortcutRevision)
      if (result.status === 'saved') {
        await Promise.all([...states.entries()].filter(([peer, value]) => peer !== window && value.definitions !== null)
          .map(async ([, value]) => { await value.persistence.readCurrent() }))
      }
      return result
    }
    const pending = editQueue.then(run)
    editQueue = pending.catch(() => {})
    return pending
  })
  deps.ipc.handle('dsh-shortcuts:recording', (event, active) => {
    const { state } = current(event)
    if (typeof active !== 'boolean') throw new Error('Invalid shortcut recording state')
    state.recording = active
    state.held.clear()
    state.owned.clear()
  })
  deps.ipc.handle('dsh-shortcuts:close-window', (event, revision) => {
    const { window, state } = current(event)
    if (typeof revision !== 'string' || state.snapshot?.revision !== revision) {
      throw new Error('Stale shortcut configuration')
    }
    window.close()
  })

  function attach(window: Window): void {
    if (states.has(window)) return
    const state: WindowState = {
      definitions: null, snapshot: null, recording: false,
      held: new Set(), owned: new Set(),
      persistence: new ShortcutPersistence(storage, 'desktop', deps.platform, true, (snapshot) => {
        state.snapshot = snapshot
        state.held.clear()
        state.owned.clear()
        if (!window.webContents.isDestroyed()) window.webContents.send('dsh-shortcuts:configuration', snapshot)
      }),
    }
    states.set(window, state)
    const resetKeys = () => { state.held.clear(); state.owned.clear() }
    window.on('blur', resetKeys)
    window.on('focus', resetKeys)
    window.on('closed', () => {
      state.persistence.dispose()
      states.delete(window)
    })
    window.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      state.definitions = null
      state.persistence.setDefinitions(null)
      state.recording = false
      state.held.clear()
      state.owned.clear()
    })
    window.webContents.on('before-input-event', (event, input) => {
      if (state.definitions === null || !state.snapshot || state.snapshot.status === 'loading' || state.recording) return
      if (input.isComposing || input.key === 'Dead' || input.key === 'AltGraph'
        || input.modifiers?.some((modifier) => /^alt(graph|gr)$/i.test(modifier))) {
        state.held.clear()
        state.owned.clear()
        return
      }
      const code = input.code
      if (!code) return
      if (input.type === 'keyUp') {
        state.held.delete(code)
        if (state.owned.delete(code)) event.preventDefault()
        if (code.startsWith('Control') || code.startsWith('Alt') || code.startsWith('Shift') || code.startsWith('Meta')) state.held.clear()
        return
      }
      if (input.type !== 'keyDown') return
      if (state.owned.has(code)) { event.preventDefault(); return }
      if (input.isAutoRepeat) return
      state.held.add(code)
      const modifiers = [
        ...(input.control ? ['control'] : []), ...(input.alt ? ['alt'] : []),
        ...(input.shift ? ['shift'] : []), ...(input.meta ? ['meta'] : []),
      ] as Array<'control' | 'alt' | 'shift' | 'meta'>
      const candidates = effectiveShortcuts(state.definitions, state.snapshot.document, 'desktop', deps.platform)
      const match = candidates.find((item) => {
        const binding = item.binding
        if (!binding || item.issue !== null || item.conflicts.length > 0) return false
        const codes = binding.secondCode ? [binding.code, binding.secondCode] : [binding.code]
        return codes.includes(code) && codes.every((part) => state.held.has(part))
          && bindingKey(binding) === bindingKey({ code: codes[0], ...(codes[1] ? { secondCode: codes[1] } : {}), modifiers })
      })
      if (!match?.binding) return
      const frame = window.webContents.focusedFrame
      if (frame?.parent != null && !frame.name) return
      event.preventDefault()
      state.owned.add(code)
      const binding = match.binding
      const payload: DesktopShortcutInput = {
        kind: frame?.parent == null ? 'keyboard' : 'iframe', frameName: frame?.parent == null ? '' : frame.name,
        revision: state.snapshot.revision,
        code: binding.code, ...(binding.secondCode ? { secondCode: binding.secondCode } : {}),
        control: input.control, alt: input.alt, shift: input.shift, meta: input.meta, repeat: false,
      }
      window.webContents.send('dsh-shortcuts:keyboard', payload)
      state.held.clear()
    })
  }

  return { attach }
}
