import { DESIGN_SYSTEM_ID } from './tokens.ts'

type AttributeHost = Pick<Element, 'getAttribute' | 'setAttribute' | 'removeAttribute'>
const owners = new WeakMap<AttributeHost, { count: number; previous: string | null }>()
const attribute = 'data-dsh-ui'

/** Reference-counted so StrictMode and multiple shell roots cannot leak the skin. */
export function mountDesignScope(root: AttributeHost): () => void {
  const state = owners.get(root) ?? { count: 0, previous: root.getAttribute(attribute) }
  state.count += 1
  owners.set(root, state)
  root.setAttribute(attribute, DESIGN_SYSTEM_ID)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    state.count -= 1
    if (state.count !== 0) return
    owners.delete(root)
    // Never undo an explicit change made by a different host after mounting.
    if (root.getAttribute(attribute) !== DESIGN_SYSTEM_ID) return
    if (state.previous === null) root.removeAttribute(attribute)
    else root.setAttribute(attribute, state.previous)
  }
}
