import { describe, expect, it } from 'vitest'
import { MODEL_SETTINGS_SLOT } from './contracts.ts'
import {
  COPY, SETTINGS_SEAT, isHostEnabledStatus, modelSettingsSlotSpec, readHostEnabled, registerExclusiveSettingsSeats,
  settingsSectionSlotSpec, shouldReplaceModelsUi, tabLabel, tablistKey, unwrapRpc, visibleSettingsSeat, type SlotHandle,
} from './client-view.ts'

function slotsMock(declared: string[]) {
  const injected: string[] = []
  const registered: string[] = []
  const pending = new Map<string, () => unknown>()
  const slots: SlotHandle & { injected: string[]; registered: string[]; declare(key: string): void } = {
    injected,
    registered,
    inject(key, callback) {
      injected.push(key)
      if (declared.includes(key)) callback()
      else pending.set(key, callback)
      return () => { pending.delete(key) }
    },
    register(spec) {
      registered.push(spec.name)
      return () => {
        const index = registered.indexOf(spec.name)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    declare(key) {
      const callback = pending.get(key)
      if (!callback) return
      pending.delete(key)
      callback()
    },
  }
  return slots
}

describe('client view helpers', () => {
  it('only replaces native models UI when host status is enabled', () => {
    expect(isHostEnabledStatus({ ok: true, value: { enabled: true, plugin: '@klarkxy/dsh-model-center' } })).toBe(true)
    expect(isHostEnabledStatus({ ok: true, value: { enabled: false, plugin: '@klarkxy/dsh-model-center' } })).toBe(false)
    expect(isHostEnabledStatus({ ok: false, error: { code: 'x', message: 'no' } })).toBe(false)
    expect(shouldReplaceModelsUi(false)).toBe(false)
  })

  it('moves through 模型配置 / 运行设置 / 供应商', () => {
    expect(tabLabel('providers', 'zh')).toBe('供应商')
    expect(tabLabel('runtime', 'zh')).toBe('运行设置')
    expect(tabLabel('policy', 'zh')).toBe('模型配置')
    expect(tablistKey('policy', 'ArrowRight')).toBe('runtime')
    expect(tablistKey('runtime', 'ArrowRight')).toBe('providers')
    expect(tablistKey('policy', 'ArrowLeft')).toBe('providers')
    expect(tablistKey('providers', 'Home')).toBe('policy')
    expect(COPY.zh.nativeHint).toBe('凭据请在原生设置中编辑。')
    expect(COPY.zh.noPurposes).toBe('没有其他功能需要单独配置。')
  })

  it('registers only the replacement seat when the editor already declared it', () => {
    expect(visibleSettingsSeat(true)).toBe('replacement')
    expect(SETTINGS_SEAT.exclusive).toBe(true)
    const slots = slotsMock([MODEL_SETTINGS_SLOT, 'settings.section'])
    registerExclusiveSettingsSeats(slots, () => null, 'zh')
    expect(slots.injected).toEqual([MODEL_SETTINGS_SLOT])
    expect(slots.registered).toEqual([MODEL_SETTINGS_SLOT])
    expect(modelSettingsSlotSpec('zh')).toEqual({
      name: MODEL_SETTINGS_SLOT, id: 'model-center', order: 0, label: '模型中心',
    })
  })

  it('registers standalone settings.section when the replacement seat is absent', () => {
    expect(visibleSettingsSeat(false)).toBe('section')
    const slots = slotsMock(['settings.section'])
    registerExclusiveSettingsSeats(slots, () => null, 'zh')
    expect(slots.injected).toEqual([MODEL_SETTINGS_SLOT, 'settings.section'])
    expect(slots.registered).toEqual(['settings.section'])
    expect(settingsSectionSlotSpec('zh').name).toBe('settings.section')
  })

  it('drops the fallback page if the replacement seat appears later', () => {
    const slots = slotsMock(['settings.section'])
    registerExclusiveSettingsSeats(slots, () => null, 'zh')
    expect(slots.registered).toEqual(['settings.section'])
    slots.declare(MODEL_SETTINGS_SLOT)
    expect(slots.registered).toEqual([MODEL_SETTINGS_SLOT])
  })

  it('unwraps RpcResult and reads host enabled over the status endpoint', async () => {
    expect(unwrapRpc({ ok: true, value: 1 })).toBe(1)
    expect(() => unwrapRpc({ ok: false, error: { code: 'x', message: '失败' } })).toThrow('失败')
    const calls: string[] = []
    expect(await readHostEnabled(async (channel, endpoint) => {
      calls.push(`${channel}:${endpoint}`)
      return { ok: true, value: { enabled: true } }
    })).toBe(true)
    expect(calls[0]).toBe('/dsh-model-center:status')
  })
})
