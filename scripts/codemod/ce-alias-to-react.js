/**
 * Rewrite React createElement calls that use a local alias (e.g.
 * `import { createElement as e } from 'react'` + `e('div', ...)`) into
 * `React.createElement(...)` so that react-codemod's create-element-to-jsx
 * can pick them up.
 *
 * Scope-aware: only rewrites call sites where the callee identifier resolves
 * to the react import binding (Program scope). Local shadowing such as
 * `(e) => ...` event parameters is left untouched.
 *
 * After rewriting, the alias import specifier is removed and a default
 * `import React from 'react'` is ensured.
 */
module.exports = function (file, api) {
  const j = api.jscodeshift
  const root = j(file.source)

  const reactImports = root.find(j.ImportDeclaration, {
    source: { value: 'react' },
  })
  if (reactImports.size() === 0) return null

  let localName = null
  reactImports
    .find(j.ImportSpecifier, { imported: { name: 'createElement' } })
    .forEach((p) => {
      localName = p.value.local && p.value.local.name
    })
  if (!localName) return null

  let touched = false

  root.find(j.CallExpression).forEach((path) => {
    const callee = path.value.callee
    if (callee.type !== 'Identifier' || callee.name !== localName) return
    const scope = path.scope.lookup(localName)
    // The import binding lives in the module (Program) scope. Any other
    // binding (function param, local var) means the identifier is shadowed.
    if (!scope || scope.node.type !== 'Program') return
    path.value.callee = j.memberExpression(
      j.identifier('React'),
      j.identifier('createElement')
    )
    touched = true
  })

  if (!touched) return null

  // Remove the now-unused createElement import specifier.
  reactImports
    .find(j.ImportSpecifier, { imported: { name: 'createElement' } })
    .remove()

  // Ensure a default React import exists.
  const hasDefault = reactImports
    .nodes()
    .some((n) =>
      (n.specifiers || []).some((s) => s.type === 'ImportDefaultSpecifier')
    )
  if (!hasDefault) {
    const first = reactImports.paths()[0]
    if (first) {
      first.value.specifiers.unshift(j.importDefaultSpecifier(j.identifier('React')))
    }
  }

  return root.toSource({ quote: 'single' })
}

module.exports.parser = 'tsx'
