import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installOfficialShortcuts } from '../src/official-shortcuts.js'

type Handler = (event: { sender: object }, ...args: unknown[]) => unknown
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function setup() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'dsh-shortcuts-'))
  dirs.push(userDataPath)
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, Array<(...args: any[]) => void>>()
  const sender = {}
  const peers = new Map<unknown, typeof window>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  let closed = false
  const window = {
    close: () => { closed = true },
    on: (name: string, listener: (...args: any[]) => void) => { listeners.set(name, [...listeners.get(name) ?? [], listener]) },
    webContents: {
      focusedFrame: null as { name: string; parent: unknown } | null,
      on: (name: string, listener: (...args: any[]) => void) => { listeners.set(name, [...listeners.get(name) ?? [], listener]) },
      send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) },
      isDestroyed: () => false,
    },
  }
  const bridge = installOfficialShortcuts({
    ipc: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    userDataPath, platform: 'windows',
    fromWebContents: (value) => value === sender ? window : peers.get(value),
    senderTrust: () => ({ owned: true, destroyed: false, isMainFrame: true,
      url: 'http://127.0.0.1:4000/', expected: new URL('http://127.0.0.1:4000/') }),
  })
  bridge.attach(window)
  const addPeer = () => {
    const peerSender = {}
    const peerSent: Array<{ channel: string; payload: unknown }> = []
    const peer = {
      close: () => {}, on: (_name: string, _listener: (...args: any[]) => void) => {},
      webContents: {
        focusedFrame: null as { name: string; parent: unknown } | null,
        on: (_name: string, _listener: (...args: any[]) => void) => {},
        send: (channel: string, payload: unknown) => { peerSent.push({ channel, payload }) },
        isDestroyed: () => false,
      },
    }
    peers.set(peerSender, peer)
    bridge.attach(peer)
    return { sent: peerSent, invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: peerSender }, ...args) }
  }
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender }, ...args)
  const input = (value: Record<string, unknown>) => {
    let prevented = false
    for (const listener of listeners.get('before-input-event') ?? []) listener({ preventDefault: () => { prevented = true } }, {
      type: 'keyDown', key: 'b', code: 'KeyB', control: true, alt: false, shift: false, meta: false, ...value,
    })
    return prevented
  }
  return { userDataPath, invoke, input, sent, listeners, window, addPeer, get closed() { return closed } }
}

const definitions = [{ id: 'editor.sidebar.toggle', defaults: {
  'desktop:windows': { code: 'KeyB', modifiers: ['primary'] },
} }]

describe('official desktop shortcut bridge', () => {
  it('routes accepted native keys and leaves composing and recording input alone', async () => {
    const app = await setup()
    const snapshot = await app.invoke('dsh-shortcuts:get', definitions) as { revision: string; status: string }
    expect(snapshot.status).toBe('ready')
    expect(app.input({ isComposing: true })).toBe(false)
    expect(app.input({ modifiers: ['altGraph'] })).toBe(false)
    expect(app.input({})).toBe(true)
    expect(app.sent.at(-1)).toMatchObject({ channel: 'dsh-shortcuts:keyboard', payload: {
      kind: 'keyboard', revision: snapshot.revision, code: 'KeyB', control: true,
    } })
    await app.invoke('dsh-shortcuts:recording', true)
    expect(app.input({})).toBe(false)
  })

  it('retains bindings across subframe and same-document navigation but revokes them for a new main document', async () => {
    const app = await setup()
    await app.invoke('dsh-shortcuts:get', definitions)
    for (const navigate of app.listeners.get('did-start-navigation') ?? []) navigate({ isMainFrame: false, isSameDocument: false })
    expect(app.input({})).toBe(true)
    expect(app.input({ type: 'keyUp' })).toBe(true)
    for (const navigate of app.listeners.get('did-start-navigation') ?? []) navigate({ isMainFrame: true, isSameDocument: true })
    expect(app.input({})).toBe(true)
    for (const navigate of app.listeners.get('did-start-navigation') ?? []) navigate({ isMainFrame: true, isSameDocument: false })
    expect(app.input({})).toBe(false)
  })

  it('resets pending chords on refocus and tags focused iframe input', async () => {
    const app = await setup()
    await app.invoke('dsh-shortcuts:get', [{ id: 'editor.chord.open', defaults: {
      'desktop:windows': { code: 'KeyF', secondCode: 'KeyG', modifiers: ['primary'] },
    } }])
    expect(app.input({ code: 'KeyF', key: 'f' })).toBe(false)
    for (const blur of app.listeners.get('blur') ?? []) blur()
    for (const focus of app.listeners.get('focus') ?? []) focus()
    expect(app.input({ code: 'KeyG', key: 'g' })).toBe(false)
    app.input({ type: 'keyUp', code: 'KeyG', key: 'g' })
    expect(app.input({ code: 'KeyF', key: 'f' })).toBe(false)
    app.window.webContents.focusedFrame = { name: 'preview', parent: {} }
    expect(app.input({ code: 'KeyG', key: 'g' })).toBe(true)
    expect(app.sent.at(-1)).toMatchObject({ channel: 'dsh-shortcuts:keyboard', payload: {
      kind: 'iframe', frameName: 'preview', secondCode: 'KeyG',
    } })
  })
  it('uses defaults when stored preferences are unreadable while rejecting edits', async () => {
    const app = await setup()
    await writeFile(join(app.userDataPath, 'keybindings.json'), '{broken')
    const snapshot = await app.invoke('dsh-shortcuts:get', definitions) as { revision: string; status: string }
    expect(snapshot.status).toBe('unreadable')
    expect(app.input({})).toBe(true)
    const result = await app.invoke('dsh-shortcuts:edit', { type: 'reset-all' }, snapshot.revision) as { status: string }
    expect(result.status).toBe('unreadable')
  })

  it('publishes edits to another window and rejects its stale draft', async () => {
    const app = await setup()
    const peer = app.addPeer()
    const ownerSnapshot = await app.invoke('dsh-shortcuts:get', definitions) as { revision: string }
    const peerSnapshot = await peer.invoke('dsh-shortcuts:get', definitions) as { revision: string }
    const saved = await app.invoke('dsh-shortcuts:edit', { type: 'set', id: 'editor.sidebar.toggle',
      binding: { code: 'KeyJ', modifiers: ['primary'] } }, ownerSnapshot.revision) as { status: string }
    expect(saved.status).toBe('saved')
    expect(peer.sent.at(-1)).toMatchObject({ channel: 'dsh-shortcuts:configuration', payload: {
      status: 'ready', document: { profiles: { 'desktop:windows': {
        'editor.sidebar.toggle': { code: 'KeyJ' },
      } } },
    } })
    const stale = await peer.invoke('dsh-shortcuts:edit', { type: 'set', id: 'editor.sidebar.toggle',
      binding: { code: 'KeyK', modifiers: ['primary'] } }, peerSnapshot.revision) as { status: string }
    expect(stale.status).toBe('stale')
  })
  it('validates definitions and edits, persists through the official protocol, and rejects stale close', async () => {
    const app = await setup()
    await expect(app.invoke('dsh-shortcuts:get', [{ id: 'bad id', defaults: {} }])).rejects.toThrow()
    const snapshot = await app.invoke('dsh-shortcuts:get', definitions) as { revision: string }
    expect(() => app.invoke('dsh-shortcuts:edit', { type: 'set', id: 'editor.sidebar.toggle', binding: { code: 'KeyJ', modifiers: ['primary'] } }, 42)).toThrow()
    const result = await app.invoke('dsh-shortcuts:edit', { type: 'set', id: 'editor.sidebar.toggle', binding: { code: 'KeyJ', modifiers: ['primary'] } }, snapshot.revision) as { status: string; snapshot: { revision: string } }
    expect(result.status).toBe('saved')
    expect((await readFile(join(app.userDataPath, 'keybindings.json'), 'utf8'))).toContain('KeyJ')
    expect(app.input({})).toBe(false)
    expect(app.input({ code: 'KeyJ', key: 'j' })).toBe(true)
    expect(() => app.invoke('dsh-shortcuts:close-window', snapshot.revision)).toThrow('Stale')
    await app.invoke('dsh-shortcuts:close-window', result.snapshot.revision)
    expect(app.closed).toBe(true)
  })
})

it('dispatches the configurable new-window combination exactly once with native revision', async () => {
  const h = await setup()
  await h.invoke('dsh-shortcuts:get', [{ id: 'editor.window.new', defaults: { 'desktop:windows': { code: 'KeyN', modifiers: ['primary', 'shift'] } } }])
  expect(h.input({ key: 'N', code: 'KeyN', shift: true })).toBe(true)
  const dispatched = h.sent.filter(item => item.channel === 'dsh-shortcuts:keyboard')
  expect(dispatched).toHaveLength(1)
  expect(dispatched[0]?.payload).toMatchObject({ kind: 'keyboard', code: 'KeyN', control: true, shift: true })
  expect(h.input({ key: 'N', code: 'KeyN', shift: true, isAutoRepeat: true })).toBe(true)
  h.input({ type: 'keyUp', key: 'N', code: 'KeyN', shift: true })
  for (const input of [{shift:false}, {alt:true,shift:true}, {meta:true,shift:true}, {control:false,shift:true}]) {
    expect(h.input({ key: 'N', code: 'KeyN', ...input })).toBe(false)
    h.input({type:'keyUp',code:'KeyN'})
  }
  expect(h.sent.filter(item => item.channel === 'dsh-shortcuts:keyboard')).toHaveLength(1)
})
