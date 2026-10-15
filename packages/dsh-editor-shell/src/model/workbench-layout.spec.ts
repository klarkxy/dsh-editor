import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AUX_MAX,
  AUX_MIN,
  AUX_OPEN_KEY,
  AUX_REVEAL_MIN,
  AUX_TAB_KEY,
  AUX_WIDTH_KEY,
  FILES_MAX,
  FILES_MIN,
  FILES_OPEN_KEY,
  FILES_WIDTH_KEY,
  WorkbenchLayoutModel,
  type LayoutStorage,
} from './workbench-layout.ts'

function storageOf(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  const storage: LayoutStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: (key) => { data.delete(key) },
  }
  return { data, storage }
}

describe('workbench layout', () => {
  describe('C31 窄窗让位', () => {
    it('窄窗冷启动：文件栏和辅助栏都让位收起，作者偏好保持原样', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      expect(layout.snapshot.files.open).toBe(false)
      expect(layout.snapshot.files.yielded).toBe(true)
      expect(layout.snapshot.aux.open).toBe(false)
      expect(layout.snapshot.aux.yielded).toBe(true)
      expect(data.get(FILES_OPEN_KEY)).toBe('true')
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })

    it('窄窗下作者打开辅助栏后，重复结算不会再关掉它', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      layout.setAuxOpen(true)
      layout.setViewport({ files: true, aux: true })
      expect(layout.snapshot.aux.open).toBe(true)
      layout.setViewport({ files: true, aux: true })
      expect(layout.snapshot.aux.open).toBe(true)
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })

    it('作者在窄窗下关掉辅助栏会写入偏好，且不因让位恢复而弹回', () => {
      const { data, storage } = storageOf({ [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      layout.setAuxOpen(true)
      layout.setAuxOpen(false)
      layout.setViewport({ files: true, aux: true })
      expect(layout.snapshot.aux.open).toBe(false)
      expect(data.get(AUX_OPEN_KEY)).toBe('false')
    })

    it('窄窗重载保持作者偏好，窗口变宽后两条栏按偏好恢复', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      expect(data.get(FILES_OPEN_KEY)).toBe('true')
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
      layout.setViewport({ files: false, aux: false })
      expect(layout.snapshot.files.open).toBe(true)
      expect(layout.snapshot.aux.open).toBe(true)
      expect(data.get(FILES_OPEN_KEY)).toBe('true')
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })

    it('900px 档位只有辅助栏让位，文件栏继续停靠', () => {
      const { storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: false, aux: true })
      expect(layout.snapshot.files.open).toBe(true)
      expect(layout.snapshot.aux.open).toBe(false)
      expect(layout.snapshot.aux.yielded).toBe(true)
    })

    it('窄窗下两条覆盖栏互斥：打开文件栏强制辅助栏让位，但不写它的偏好', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      layout.setAuxOpen(true)
      layout.setFilesOpen(true)
      expect(layout.snapshot.files.open).toBe(true)
      expect(layout.snapshot.aux.open).toBe(false)
      expect(layout.snapshot.aux.yielded).toBe(true)
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })

    it('窄窗下打开辅助栏强制文件栏让位，同样不写它的偏好', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      layout.setFilesOpen(true)
      layout.setAuxOpen(true)
      expect(layout.snapshot.aux.open).toBe(true)
      expect(layout.snapshot.files.open).toBe(false)
      expect(data.get(FILES_OPEN_KEY)).toBe('true')
    })

    it('切换作品时重读偏好再结算：窄窗里的「开」偏好不会弹回栏位', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setViewport({ files: true, aux: true })
      layout.workspaceChanged('w2')
      expect(layout.snapshot.files.open).toBe(false)
      expect(layout.snapshot.files.yielded).toBe(true)
      expect(layout.snapshot.aux.open).toBe(false)
      expect(data.get(FILES_OPEN_KEY)).toBe('true')
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })
  })

  describe('C32 栏宽与 reveal', () => {
    it('作者宽度写入并夹在档位内', () => {
      const { data, storage } = storageOf()
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setFilesWidth(180)
      expect(layout.filesViewWidth).toBe(FILES_MIN)
      expect(data.get(FILES_WIDTH_KEY)).toBe(String(FILES_MIN))
      layout.setAuxWidth(700)
      expect(layout.auxViewWidth).toBe(AUX_MAX)
      expect(data.get(AUX_WIDTH_KEY)).toBe(String(AUX_MAX))
    })

    it('reveal 只改当前视图宽度到 336，不改保存的作者宽度', () => {
      const { data, storage } = storageOf({ [AUX_WIDTH_KEY]: String(AUX_MIN) })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setAuxOpen(false)
      layout.revealTools()
      expect(layout.snapshot.aux.open).toBe(true)
      expect(layout.snapshot.aux.tab).toBe('tools')
      expect(layout.auxViewWidth).toBe(AUX_REVEAL_MIN)
      expect(data.get(AUX_WIDTH_KEY)).toBe(String(AUX_MIN))
      const reloaded = new WorkbenchLayoutModel(storage, 'w1')
      expect(reloaded.auxViewWidth).toBe(AUX_MIN)
    })

    it('reveal 在窗口换档后继续生效，重挂网格仍用 reveal 宽度', () => {
      const { storage } = storageOf({ [AUX_WIDTH_KEY]: String(AUX_MIN) })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.revealTools()
      layout.setViewport({ files: false, aux: true })
      layout.setViewport({ files: true, aux: true })
      layout.setViewport({ files: false, aux: false })
      expect(layout.auxViewWidth).toBe(AUX_REVEAL_MIN)
    })

    it('作者拖出的新宽度覆盖并清除 reveal', () => {
      const { data, storage } = storageOf({ [AUX_WIDTH_KEY]: String(AUX_MIN) })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.revealTools()
      layout.setAuxWidth(380)
      expect(layout.auxViewWidth).toBe(380)
      expect(data.get(AUX_WIDTH_KEY)).toBe('380')
    })

    it('作者宽度已经比 reveal 宽时保持原宽度', () => {
      const { storage } = storageOf({ [AUX_WIDTH_KEY]: '500' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.revealTools()
      expect(layout.auxViewWidth).toBe(500)
    })
  })

  describe('页签', () => {
    it('作者手动切换页签写入 aux-tab', () => {
      const { data, storage } = storageOf()
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.selectAuxTab('tools')
      expect(layout.auxTab).toBe('tools')
      expect(data.get(AUX_TAB_KEY)).toBe('tools')
    })

    it('存储里没有合法页签时回到「搭档」', () => {
      const { storage } = storageOf({ [AUX_TAB_KEY]: 'bogus' })
      expect(new WorkbenchLayoutModel(storage, 'w1').auxTab).toBe('partner')
    })

    it('系统来源的页签切换不写 aux-tab', () => {
      const { data, storage } = storageOf({ [AUX_TAB_KEY]: 'partner' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.focusPartner()
      expect(layout.auxTab).toBe('partner')
      layout.pinReference()
      expect(layout.auxTab).toBe('reference')
      layout.revealTools()
      expect(layout.auxTab).toBe('tools')
      layout.openRightbarPreview()
      expect(layout.auxTab).toBe('reference')
      expect(data.get(AUX_TAB_KEY)).toBe('partner')
    })

    it('钉住是作者行为：pinReference 展开辅助栏写 assistant-open，但不写页签', () => {
      const { data, storage } = storageOf({ [AUX_OPEN_KEY]: 'false', [AUX_TAB_KEY]: 'partner' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.pinReference()
      expect(layout.snapshot.aux.open).toBe(true)
      expect(layout.auxTab).toBe('reference')
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
      expect(data.get(AUX_TAB_KEY)).toBe('partner')
    })
  })

  describe('右侧栏预览（系统动作）', () => {
    it('辅助栏关着时系统展开不写偏好，closeRightbar 收回', () => {
      const { data, storage } = storageOf({ [AUX_OPEN_KEY]: 'false' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.openRightbarPreview()
      expect(layout.snapshot.aux.open).toBe(true)
      expect(layout.snapshot.aux.tab).toBe('reference')
      expect(data.get(AUX_OPEN_KEY)).toBe('false')
      layout.closeRightbarPreview()
      expect(layout.snapshot.aux.open).toBe(false)
      expect(data.get(AUX_OPEN_KEY)).toBe('false')
    })

    it('辅助栏已经开着时 closeRightbar 只停在「资料」，不收栏', () => {
      const { data, storage } = storageOf({ [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.openRightbarPreview()
      layout.closeRightbarPreview()
      expect(layout.snapshot.aux.open).toBe(true)
      expect(layout.snapshot.aux.tab).toBe('reference')
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })

    it('作者在系统展开后接管辅助栏，closeRightbar 不再收回', () => {
      const { data, storage } = storageOf({ [AUX_OPEN_KEY]: 'false' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.openRightbarPreview()
      layout.setAuxOpen(true)
      layout.closeRightbarPreview()
      expect(layout.snapshot.aux.open).toBe(true)
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
    })
  })

  describe('专注模式', () => {
    it('进出专注模式不改面板状态，退出即恢复', () => {
      const { storage } = storageOf({ [FILES_OPEN_KEY]: 'true', [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.enterFocus()
      expect(layout.snapshot.focus).toBe(true)
      expect(layout.snapshot.files.open).toBe(true)
      expect(layout.snapshot.aux.open).toBe(true)
      layout.exitFocus()
      expect(layout.snapshot.focus).toBe(false)
      expect(layout.snapshot.files.open).toBe(true)
      expect(layout.snapshot.aux.open).toBe(true)
    })

    it('专注模式下作者显式开关栏位会先退出专注', () => {
      const { storage } = storageOf()
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.enterFocus()
      layout.setFilesOpen(false)
      expect(layout.snapshot.focus).toBe(false)
    })
  })

  describe('单稿件自动收合', () => {
    it('单稿件作品自动收起文件栏，但不改保存的偏好', () => {
      const { data, storage } = storageOf({ [FILES_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.manuscriptCensus(true)
      expect(layout.snapshot.files.open).toBe(false)
      expect(data.get(FILES_OPEN_KEY)).toBe('true')
      layout.manuscriptCensus(false)
      expect(layout.snapshot.files.open).toBe(true)
    })
  })

  describe('抽屉与顶栏开关是同一作者操作', () => {
    it('抽屉关闭和顶栏切换写入同一个键', () => {
      const { data, storage } = storageOf({ [AUX_OPEN_KEY]: 'true' })
      const layout = new WorkbenchLayoutModel(storage, 'w1')
      layout.setAuxOpen(false)
      expect(data.get(AUX_OPEN_KEY)).toBe('false')
      layout.setViewport({ files: true, aux: true })
      layout.setAuxOpen(true)
      expect(data.get(AUX_OPEN_KEY)).toBe('true')
      layout.setViewport({ files: true, aux: true })
      expect(layout.snapshot.aux.open).toBe(true)
    })
  })

  it('production wiring: workbench 面板初值使用模型视图宽度', () => {
    const workbench = readFileSync(new URL('../app/shell/workbench.tsx', import.meta.url), 'utf-8')
    expect(workbench).toContain('defaultSize={layout.filesViewWidth}')
    expect(workbench).toContain('defaultSize={layout.auxViewWidth}')
  })
})
