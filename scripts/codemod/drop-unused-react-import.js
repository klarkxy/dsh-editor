/**
 * Remove the default `import React from 'react'` (or the default specifier
 * from a combined import) when the file no longer references the `React`
 * namespace. With the react-jsx runtime the import is dead weight left over
 * from the createElement -> JSX codemod.
 */
module.exports = function (file, api) {
  const j = api.jscodeshift
  const root = j(file.source)

  const usesReact = root
    .find(j.MemberExpression, { object: { name: 'React' } })
    .size() > 0
    || root.find(j.JSXMemberExpression, { object: { name: 'React' } }).size() > 0
  if (usesReact) return null

  let touched = false
  root
    .find(j.ImportDeclaration, { source: { value: 'react' } })
    .forEach((path) => {
      const specifiers = path.value.specifiers ?? []
      const hasDefault = specifiers.some((s) => s.type === 'ImportDefaultSpecifier' && s.local?.name === 'React')
      if (!hasDefault) return
      const rest = specifiers.filter((s) => !(s.type === 'ImportDefaultSpecifier' && s.local?.name === 'React'))
      if (rest.length === 0) {
        // keep a side-effect-free removal: drop the whole declaration
        path.prune()
      } else {
        path.value.specifiers = rest
      }
      touched = true
    })

  return touched ? root.toSource({ quote: 'single' }) : null
}

module.exports.parser = 'tsx'
