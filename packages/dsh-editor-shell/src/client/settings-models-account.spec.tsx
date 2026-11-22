/**
 * DeepSeek account row on the models page. No DOM renderer exists in this
 * repo's vitest environment, so — like settings-models-catalog.spec.tsx —
 * React's stateful hooks are mocked with a slot table and effects are flushed
 * by hand; the watch stream is a controllable async queue.
 */
import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountUpdate, AccountView } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { useDeepseekAccount, useDeepseekAccountControls } from './settings-models-account.tsx'
import { RowHead } from './settings-models.tsx'
import { ConfirmDialog } from './dialogs.tsx'
import { resetLocaleForTests } from '../i18n/index.ts'
import type { ProviderRow } from './settings-models-store.ts'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: vi.fn(),
  useRef: vi.fn(),
  useMemo: vi.fn(),
  useEffect: vi.fn(),
  useSyncExternalStore: vi.fn(),
}))

/* ------------------------------------------------------------------ *
 * Hook slot/effect plumbing (same pattern as the catalog spec, plus a
 * mini effect runner that honors dep equality).
 * ------------------------------------------------------------------ */

let slots: unknown[] = []
let cursor = 0
let pendingEffects: Array<{ fn: () => void | (() => void); deps: unknown[] | undefined }> = []
const mountedEffects: Array<{ deps: unknown[] | undefined; cleanup?: () => void } | undefined> = []

function depsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

vi.mocked(useState).mockImplementation(((initial: unknown) => {
  const index = cursor++
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
  return [slots[index], (next: SetStateAction<unknown>) => {
    slots[index] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slots[index]) : next
  }]
}) as typeof useState)

vi.mocked(useRef).mockImplementation(((initial: unknown) => {
  const index = cursor++
  if (!(index in slots)) slots[index] = { current: initial }
  return slots[index]
}) as typeof useRef)

vi.mocked(useMemo).mockImplementation(((factory: () => unknown, deps: unknown[] | undefined) => {
  const index = cursor++
  const slot = slots[index] as { deps: unknown[] | undefined; value: unknown } | undefined
  if (!slot || !depsEqual(slot.deps, deps)) slots[index] = { deps, value: factory() }
  return (slots[index] as { value: unknown }).value
}) as typeof useMemo)

vi.mocked(useEffect).mockImplementation(((fn: () => void | (() => void), deps?: unknown[]) => {
  pendingEffects.push({ fn, deps })
}) as typeof useEffect)

vi.mocked(useSyncExternalStore).mockImplementation(((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as unknown as typeof useSyncExternalStore)

/** Run one render pass and flush the effects it collected, React-style. */
function render(fn: () => ReactNode): ReactNode {
  cursor = 0
  pendingEffects = []
  const tree = fn()
  const batch = pendingEffects
  for (const [index, eff] of batch.entries()) {
    const previous = mountedEffects[index]
    if (previous !== undefined && depsEqual(previous.deps, eff.deps)) continue
    previous?.cleanup?.()
    const cleanup = eff.fn()
    mountedEffects[index] = { deps: eff.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
  }
  mountedEffects.length = batch.length
  return tree
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/* ------------------------------------------------------------------ *
 * Tree inspection helpers.
 * ------------------------------------------------------------------ */

function nodes(tree: ReactNode, predicate: (node: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate))
  if (!isValidElement<Record<string, unknown>>(tree)) return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children as ReactNode, predicate)]
}

function byTestId(tree: ReactNode, id: string): ReactElement<Record<string, unknown>> | undefined {
  return nodes(tree, (node) => node.props['data-testid'] === id)[0]
}

function click(tree: ReactNode, id: string): void {
  const button = byTestId(tree, id)
  expect(button, `button ${id}`).toBeTruthy()
  ;(button!.props.onClick as () => void)()
}

/* ------------------------------------------------------------------ *
 * Fake remote.account + controllable watch stream.
 * ------------------------------------------------------------------ */

const ORIGIN = 'http://127.0.0.1:8788'
const LINKS = { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top-up' }

function view(status: AccountView['status'], attempt?: AccountView['attempt']): AccountView {
  return { status, links: LINKS, attempt: attempt ?? null }
}

function waitingAttempt(id: string, authorizeUrl?: string) {
  return { id, phase: 'waiting-browser' as const, authorizeUrl }
}

/* rc.5 的 account/watch 流元素是 `{type, state}` 事件壳,快照在 state 里。 */
function update(state: AccountView, type: AccountUpdate['type'] = 'snapshot'): AccountUpdate {
  return { type, state }
}

function makeStream() {
  const items: AccountUpdate[] = []
  const waiters: Array<() => void> = []
  let done = false
  return {
    disposed: false,
    push(next: AccountUpdate) { items.push(next); for (const wake of waiters.splice(0)) wake() },
    end() { done = true; for (const wake of waiters.splice(0)) wake() },
    dispose() { this.disposed = true; done = true; for (const wake of waiters.splice(0)) wake() },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          for (;;) {
            const item = items.shift()
            if (item !== undefined) return { value: item, done: false as const }
            if (done) return { value: undefined, done: true as const }
            await new Promise<void>((resolve) => waiters.push(resolve))
          }
        },
      }
    },
  }
}

function makeRemote(stream: ReturnType<typeof makeStream>, overrides: Record<string, unknown> = {}) {
  return {
    getState: vi.fn(async () => ({ ok: true, value: view('signed-out') })),
    startSignIn: vi.fn(async (_client: unknown, _origin: string, _source: string) => ({ ok: true, value: view('signed-out', { id: 'att-1', phase: 'initializing' }) })),
    cancelSignIn: vi.fn(async (_attemptId: string) => ({ ok: true, value: view('signed-out') })),
    signOut: vi.fn(async (_client: unknown) => ({ ok: true, value: view('signed-out') })),
    getProfile: vi.fn(async () => ({ ok: true, value: { status: 'ready', value: { id: 'u1', name: '作者甲', contact: 'masked@example.com' } } })),
    hasRunningAccountTasks: vi.fn(async () => ({ ok: true, value: false })),
    watch: vi.fn(() => stream),
    ...overrides,
  }
}

function makeCtx(remote: ReturnType<typeof makeRemote> | undefined) {
  const listeners = new Map<string, Array<() => void>>()
  const ctx = {
    remote: remote === undefined ? {} : { account: remote },
    on: (event: string, listener: () => void) => {
      const group = listeners.get(event) ?? []
      group.push(listener)
      listeners.set(event, group)
      return () => { listeners.set(event, group.filter((entry) => entry !== listener)) }
    },
    emit(event: string) { for (const listener of listeners.get(event) ?? []) listener() },
  }
  return ctx as unknown as ShellContext & { emit(event: string): void }
}

/* The account controls need a ctx + the hook state; render both hooks in one
   pass so slot ordering stays stable. */
function Harness(props: { ctx: ShellContext }): ReactNode {
  const account = useDeepseekAccount(props.ctx)
  const controls = useDeepseekAccountControls(props.ctx, account, true)
  return [controls.actions, controls.detail]
}

const bridge = {
  openExternal: vi.fn(),
  getAppInfo: vi.fn(async () => ({ name: 'DSH Editor', version: '9.9.9', platform: 'win32', portable: false })),
  clipboard: { writeText: vi.fn(async () => {}) },
}

beforeEach(() => {
  slots = []
  cursor = 0
  pendingEffects = []
  mountedEffects.length = 0
  vi.clearAllMocks()
  bridge.openExternal = vi.fn()
  bridge.getAppInfo = vi.fn(async () => ({ name: 'DSH Editor', version: '9.9.9', platform: 'win32', portable: false }))
  bridge.clipboard = { writeText: vi.fn(async () => {}) }
  ;(globalThis as { dshWindow?: unknown }).dshWindow = bridge
  ;(globalThis as { window?: unknown }).window = { location: { origin: ORIGIN } }
})

afterEach(() => {
  delete (globalThis as { dshWindow?: unknown }).dshWindow
  delete (globalThis as { window?: unknown }).window
  resetLocaleForTests()
})

describe('useDeepseekAccount + account row controls', () => {
  it('clicking 登录 starts a web sign-in with client metadata and the page origin', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    const ctx = makeCtx(remote)
    let tree = render(() => Harness({ ctx }))
    await tick()
    tree = render(() => Harness({ ctx }))
    click(tree, 'dsh-models-account-signin')
    await tick()
    expect(remote.startSignIn).toHaveBeenCalledTimes(1)
    const [client, origin, source] = remote.startSignIn.mock.calls[0]!
    expect(client).toEqual({
      version: '9.9.9',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
    expect(origin).toBe(ORIGIN)
    expect(source).toBe('web')
  })

  it('auto-opens the authorize page exactly once for the attempt this page started', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    const ctx = makeCtx(remote)
    let tree = render(() => Harness({ ctx }))
    await tick()
    tree = render(() => Harness({ ctx }))
    click(tree, 'dsh-models-account-signin')
    await tick()

    stream.push(update(view('signed-out', waitingAttempt('att-1', 'https://platform.deepseek.com/authorize?attempt=att-1'))))
    await tick()
    tree = render(() => Harness({ ctx }))
    expect(bridge.openExternal).toHaveBeenCalledTimes(1)
    expect(bridge.openExternal).toHaveBeenCalledWith('https://platform.deepseek.com/authorize?attempt=att-1')

    // Watch replays / reconnects never re-open it.
    stream.push(update(view('signed-out', waitingAttempt('att-1', 'https://platform.deepseek.com/authorize?attempt=att-1'))))
    await tick()
    render(() => Harness({ ctx }))
    expect(bridge.openExternal).toHaveBeenCalledTimes(1)

    // A pending attempt this page did not start is not auto-opened.
    stream.push(update(view('signed-out', waitingAttempt('att-other', 'https://platform.deepseek.com/authorize?attempt=att-other'))))
    await tick()
    tree = render(() => Harness({ ctx }))
    expect(bridge.openExternal).toHaveBeenCalledTimes(1)

    // The pending state offers manual open/copy/cancel while waiting.
    expect(byTestId(tree, 'dsh-models-account-open')).toBeTruthy()
    expect(byTestId(tree, 'dsh-models-account-copy')).toBeTruthy()
    expect(byTestId(tree, 'dsh-models-account-cancel')).toBeTruthy()
  })

  it('still auto-opens when the waiting-browser frame lands before startSignIn resolves', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    let resolveSignIn: ((value: { ok: boolean; value: AccountView }) => void) | undefined
    remote.startSignIn.mockImplementationOnce(
      () => new Promise<{ ok: boolean; value: AccountView }>((resolve) => { resolveSignIn = resolve }),
    )
    const ctx = makeCtx(remote)
    let tree = render(() => Harness({ ctx }))
    await tick()
    tree = render(() => Harness({ ctx }))
    click(tree, 'dsh-models-account-signin')

    // The stream delivers the authorize URL while the start call is still in
    // flight; nothing may open yet (the page cannot prove it owns the attempt).
    stream.push(update(view('signed-out', waitingAttempt('att-race', 'https://platform.deepseek.com/authorize?attempt=att-race'))))
    await tick()
    render(() => Harness({ ctx }))
    expect(bridge.openExternal).not.toHaveBeenCalled()

    // Once the answer names the same attempt, the deferred URL opens once.
    resolveSignIn!({ ok: true, value: view('signed-out', { id: 'att-race', phase: 'exchanging' }) })
    await tick()
    render(() => Harness({ ctx }))
    expect(bridge.openExternal).toHaveBeenCalledTimes(1)
    expect(bridge.openExternal).toHaveBeenCalledWith('https://platform.deepseek.com/authorize?attempt=att-race')
  })

  it('opens the authorizeUrl carried by the start answer itself, and replays never re-open', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream, {
      startSignIn: vi.fn(async () => ({
        ok: true,
        value: view('signed-out', waitingAttempt('att-direct', 'https://platform.deepseek.com/authorize?attempt=att-direct')),
      })),
    })
    const ctx = makeCtx(remote)
    render(() => Harness({ ctx }))
    await tick()
    const tree = render(() => Harness({ ctx }))
    click(tree, 'dsh-models-account-signin')
    await tick()
    render(() => Harness({ ctx }))
    expect(bridge.openExternal).toHaveBeenCalledTimes(1)

    stream.push(update(view('signed-out', waitingAttempt('att-direct', 'https://platform.deepseek.com/authorize?attempt=att-direct'))))
    await tick()
    render(() => Harness({ ctx }))
    expect(bridge.openExternal).toHaveBeenCalledTimes(1)
  })

  it('a rejecting clipboard shows the copy-failed label', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    const ctx = makeCtx(remote)
    bridge.clipboard.writeText = vi.fn(async () => { throw new Error('denied') })
    render(() => Harness({ ctx }))
    await tick()
    stream.push(update(view('signed-out', waitingAttempt('att-9', 'https://platform.deepseek.com/authorize?x=9'))))
    await tick()
    const tree = render(() => Harness({ ctx }))
    click(tree, 'dsh-models-account-copy')
    await tick()
    const rendered = render(() => Harness({ ctx }))
    expect(byTestId(rendered, 'dsh-models-account-copy')?.props.children).toBe('复制失败')
  })

  it('取消 calls cancelSignIn with the pending attempt id', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    const ctx = makeCtx(remote)
    render(() => Harness({ ctx }))
    await tick()
    render(() => Harness({ ctx }))
    stream.push(update(view('signed-out', waitingAttempt('att-9', 'https://platform.deepseek.com/authorize?x=9'))))
    await tick()
    const tree = render(() => Harness({ ctx }))
    click(tree, 'dsh-models-account-cancel')
    await tick()
    expect(remote.cancelSignIn).toHaveBeenCalledTimes(1)
    expect(remote.cancelSignIn).toHaveBeenCalledWith('att-9')
  })

  it('a failed attempt with errorCode no-response shows the network message', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    const ctx = makeCtx(remote)
    render(() => Harness({ ctx }))
    await tick()
    stream.push(update(view('signed-out', { id: 'att-x', phase: 'failed', errorCode: 'no-response' })))
    await tick()
    const tree = render(() => Harness({ ctx }))
    const notices = nodes(tree, (node) => node.props.className === 'models-account-error')
    expect(notices).toHaveLength(1)
    expect(notices[0]!.props.children).toBe('无法连接 DeepSeek，请检查网络后重试。')
    // The 登录 button stays available as the retry.
    expect(byTestId(tree, 'dsh-models-account-signin')).toBeTruthy()
  })

  it('signed-in shows 退出登录 and no 编辑; confirming the dialog signs out', async () => {
    const stream = makeStream()
    const remote = makeRemote(stream)
    const ctx = makeCtx(remote)
    render(() => Harness({ ctx }))
    await tick()
    stream.push(update(view('credential-stored')))
    await tick()
    const tree = render(() => Harness({ ctx }))
    expect(byTestId(tree, 'dsh-models-account-signout')).toBeTruthy()
    expect(byTestId(tree, 'dsh-models-account-signin')).toBeUndefined()

    click(tree, 'dsh-models-account-signout')
    await tick()
    expect(remote.hasRunningAccountTasks).toHaveBeenCalledTimes(1)
    const afterRequest = render(() => Harness({ ctx }))
    const dialog = nodes(afterRequest, (node) => node.type === ConfirmDialog)[0]
    expect(dialog, 'sign-out confirm dialog').toBeTruthy()
    expect(dialog!.props.open).toBe(true)
    ;(dialog!.props.onConfirm as () => void)()
    await tick()
    expect(remote.signOut).toHaveBeenCalledTimes(1)
    expect(remote.signOut.mock.calls[0]![0]).toEqual({
      version: '9.9.9',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })

    // rc.5 凭据移除走 credentials-changed;同一挂载实例消费 event.state 后
    // 立刻回到登录入口,不必重开设置页。
    stream.push(update(view('signed-out'), 'credentials-changed'))
    await tick()
    const afterSignOut = render(() => Harness({ ctx }))
    expect(byTestId(afterSignOut, 'dsh-models-account-signout')).toBeUndefined()
    expect(byTestId(afterSignOut, 'dsh-models-account-signin')).toBeTruthy()

    // The account row head swaps the API-key 编辑 button for account controls.
    // RowHead has a different hook graph than Harness, so it gets a fresh slot
    // table rather than sharing the harness's.
    slots = []
    mountedEffects.length = 0
    const row: ProviderRow = {
      entry: {
        provider: 'deepseek-account',
        id: 'deepseek-account',
        displayName: 'DeepSeek Account',
        settingsNs: 'llm-deepseek-account',
        settingsPath: [],
        active: true,
      },
      configured: true,
      removable: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }
    const onEdit = vi.fn()
    const head = render(() => RowHead({
      ctx,
      row,
      account: { available: true, view: view('credential-stored') },
      writable: true,
      open: false,
      onEdit,
      onDelete: vi.fn(),
    }))
    expect(byTestId(head, 'dsh-models-account-signout')).toBeTruthy()
    expect(nodes(head, (node) => node.props['aria-label'] === '编辑 DeepSeek Account')).toHaveLength(0)
    expect(nodes(head, (node) => node.props.onClick === onEdit)).toHaveLength(0)
  })

  it('without remote.account the row degrades to a muted note and no buttons', async () => {
    const ctx = makeCtx(undefined)
    render(() => Harness({ ctx }))
    await tick()
    const rendered = render(() => Harness({ ctx }))
    expect(byTestId(rendered, 'dsh-models-account-signin')).toBeUndefined()
    expect(byTestId(rendered, 'dsh-models-account-signout')).toBeUndefined()
    expect(byTestId(rendered, 'dsh-models-account-cancel')).toBeUndefined()
    expect(nodes(rendered, (node) => typeof node.type === 'function' && node.props['data-testid'] !== undefined)).toHaveLength(0)
    const statusTexts = nodes(rendered, (node) => node.props.className === 'models-account-status')
    expect(statusTexts).toHaveLength(1)
    expect(statusTexts[0]!.props.children).toBe('当前环境不支持账号登录。')
  })
})
