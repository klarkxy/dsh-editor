import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as plugins } from '../packages/dsh-editor-plugins/src/client.tsx'
import { apply as search } from '../packages/dsh-web-search-manager/src/client.tsx'
import { apply as zhihu } from '../packages/dsh-zhihu/src/client.tsx'

function documentFixture() {
  const nodes = []
  const head = {
    appendChild(node) { nodes.push(node) },
    querySelector() { return nodes.find(node => node.attrs.has('data-dsh-plugins-styles')) ?? null },
  }
  vi.stubGlobal('document', {
    head,
    createElement() {
      return {
        attrs: new Map(), dataset: {}, textContent: '',
        setAttribute(key, value) { this.attrs.set(key, value) },
        remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1) },
      }
    },
  })
  return nodes
}
function mount(apply) {
  const effects = []
  apply({
    effect(run, label) { const dispose = run(); effects.push({ run, label, dispose }) },
    slots: { inject() {}, register() {} },
    connection: { rpc: { call() {} } },
  })
  return effects
}
// The upstream module loader claims every unowned style for the next factory;
// HMR later deletes the styles that carry that factory's package id.
function reloadUnrelatedModule(nodes) {
  for (const node of nodes) if (!node.attrs.has('data-plugin')) node.attrs.set('data-plugin', 'unrelated-plugin')
  for (const node of [...nodes]) if (node.attrs.get('data-plugin') === 'unrelated-plugin') node.remove()
}
afterEach(() => vi.unstubAllGlobals())
describe('settings stylesheet ownership', () => {
  for (const [id, apply] of [['dsh-editor-plugins', plugins], ['@klarkxy/dsh-web-search-manager', search], ['@klarkxy/dsh-zhihu', zhihu]]) {
    it(`${id} survives another module's materialization and reload`, () => {
      const nodes = documentFixture()
      mount(apply)
      expect(nodes).toHaveLength(1)
      expect(nodes[0].attrs.get('data-plugin')).toBe(id)
      expect(nodes[0].textContent.length).toBeGreaterThan(1000)
      reloadUnrelatedModule(nodes)
      expect(nodes).toHaveLength(1)
    })
    it(`${id} replaces its own stylesheet on plugin reload`, () => {
      const nodes = documentFixture()
      const effects = mount(apply)
      for (const effect of effects) effect.dispose?.()
      for (const node of [...nodes]) if (node.attrs.get('data-plugin') === id) node.remove()
      expect(nodes).toHaveLength(0)
      mount(apply)
      expect(nodes).toHaveLength(1)
      expect(nodes[0].attrs.get('data-plugin')).toBe(id)
    })
  }
  it('recreates Zhihu styles when the same effect restarts', () => {
    const nodes = documentFixture()
    const effect = mount(zhihu).find(effect => effect.label === 'zhihu.styles')
    effect.dispose()
    expect(nodes).toHaveLength(0)
    const dispose = effect.run()
    expect(nodes).toHaveLength(1)
    dispose()
    expect(nodes).toHaveLength(0)
  })
})