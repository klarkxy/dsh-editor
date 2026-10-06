import { describe, expect, it, vi } from 'vitest'
import {
  NATIVE_PLUGIN_MANAGER_KEY,
  NATIVE_PLUGIN_MANAGER_PACKAGE,
  NATIVE_PLUGIN_MANAGER_SEAT,
  adaptNativePluginManagerSeat,
  managerSeatFacade,
} from './native-plugin-manager-seat.ts'

describe('native plugin manager seat facade', () => {
  it('maps only official main inject/register onto the private seat and forwards the rest', () => {
    const inject = vi.fn((key: string, callback: unknown) => ({ key, callback }))
    const register = vi.fn((spec: object, component: unknown) => ({ spec, component }))
    const extra = vi.fn(function (this: { marker: string }) { return this.marker })
    const native = { inject, register, extra, marker: 'native', locale: 'pluginManager' }
    const facade = managerSeatFacade(native)
    const callback = function* () { yield 1 }
    facade.inject('main', callback)
    facade.inject('shell.overlay', callback)
    const children = { 'plugins.item': { kind: 'list', scope: 'root' } }
    const store = { create: () => ({}) }
    facade.register({
      name: 'main',
      key: NATIVE_PLUGIN_MANAGER_KEY,
      locale: 'pluginManager',
      store,
      inject: () => ({}),
      children,
    }, 'page')
    facade.register({ name: 'shell.overlay', id: 'plugin-manager.refresh-toast' }, 'toast')
    expect(inject).toHaveBeenCalledWith(NATIVE_PLUGIN_MANAGER_SEAT, callback)
    expect(inject).toHaveBeenCalledWith('shell.overlay', callback)
    expect(register.mock.calls[0]?.[0]).toEqual({
      name: NATIVE_PLUGIN_MANAGER_SEAT,
      key: NATIVE_PLUGIN_MANAGER_KEY,
      locale: 'pluginManager',
      store,
      inject: expect.any(Function),
      children,
    })
    expect(register.mock.calls[1]?.[0]).toEqual({ name: 'shell.overlay', id: 'plugin-manager.refresh-toast' })
    expect(facade.locale).toBe('pluginManager')
    expect(facade.extra()).toBe('native')
  })

  it('adapts only the official manager entry through the public patch-context waterfall', () => {
    const listeners: Array<(entry: object, next: () => void) => void> = []
    const parent = {
      ctx: {
        extend(meta: { slots?: unknown }) {
          return Object.create(this, Object.getOwnPropertyDescriptors(meta))
        },
      },
    }
    const nativeSlots = {
      inject: vi.fn((key: string) => key),
      register: vi.fn((spec: { name: string }) => spec.name),
    }
    const managerCtx = {
      get(name: string) {
        expect(name).toBe('slots')
        return nativeSlots
      },
    }
    const otherCtx = { get() { throw new Error('other plugin must keep native slots') } }
    const manager = {
      options: { name: NATIVE_PLUGIN_MANAGER_PACKAGE },
      ctx: managerCtx,
      parent,
      update: vi.fn(() => Promise.resolve()),
    }
    const other = {
      options: { name: '@deepseek-ai/dsh-client-ui-conversation' },
      ctx: otherCtx,
      parent,
      update: vi.fn(),
    }
    const ctx = {
      on(name: string, listener: (entry: object, next: () => void) => void) {
        expect(name).toBe('loader/patch-context')
        listeners.push(listener)
      },
      get() {
        return { entries: () => [manager, other] }
      },
    }
    adaptNativePluginManagerSeat(ctx)
    expect(manager.update).toHaveBeenCalledWith({}, false, true)
    expect(other.update).not.toHaveBeenCalled()
    const next = vi.fn(() => {
      Object.setPrototypeOf(manager.ctx, parent.ctx)
    })
    listeners[0]?.(manager, next)
    expect(next).toHaveBeenCalledOnce()
    expect((manager.ctx as { slots: { inject(key: string): string } }).slots.inject('main')).toBe(NATIVE_PLUGIN_MANAGER_SEAT)
    listeners[0]?.(other, () => {})
    expect(other.ctx).toBe(otherCtx)
  })
})
