import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { resolveDshInstallation } from './dsh-cli.mjs'

// Exercise the installed patched renderer, rather than checking that its source
// merely contains the expected strings. An incorrectly applied hunk can remain
// valid JavaScript while throwing only when React renders a plugin detail page.
const installation = resolveDshInstallation()
const require = createRequire(join(installation.packageRoot, 'package.json'))
const entry = require.resolve('@deepseek-ai/dsh-client-ui-plugin-manager')
const source = readFileSync(join(dirname(entry), 'client.js'), 'utf8')
const parsed = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
let renderer
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'RowsSection') renderer = node.getText(parsed)
  ts.forEachChild(node, find)
}
find(parsed)
if (!renderer) throw new Error('Pinned plugin manager renderer was not found')
const jsx = (type, props) => ({ type, props })
const renderRows = runInNewContext(`(${renderer})`, {
  react: { useState: () => ['', () => {}] },
  react_jsx_runtime: { jsx, jsxs: jsx },
  PluginManagerPage_module_css_default: {},
  _deepseek_ai_dsh_client_ui_primitives: {},
  ROW_FILTER_THRESHOLD: 20,
  rowText: row => ({ title: row.rowId, description: row.description }),
  partsSummary: rows => `${rows.length} components`,
  rowDotState: row => row.phase,
  rowStateText: row => row.phase,
  PackageArtwork: 'Artwork',
  MetadataError: 'MetadataError',
  RowSwitch: 'RowSwitch',
})
const props = rows => ({ rows, packageName: 'example-plugin', t: key => key, resolveText: value => value })

describe('pinned plugin manager detail patch', () => {
  it('renders the advanced summary and package name as sibling children without a runtime exception', () => {
    const tree = renderRows(props([]))
    expect(tree.type).toBe('details')
    expect(tree.props.open).toBe(false)
    expect(tree.props.children[0].type).toBe('summary')
    expect(tree.props.children[1].type).toBe('p')
    expect(tree.props.children[1].props.children.props.children).toBe('example-plugin')
  })

  it('opens failed components and metadata errors while keeping healthy components collapsed', () => {
    const row = { rowId: 'example-row', moduleName: 'example-module', enabled: true, phase: 'active' }
    expect(renderRows(props([row])).props.open).toBe(false)
    expect(renderRows(props([{ ...row, phase: 'failed' }])).props.open).toBe(true)
    expect(renderRows(props([{ ...row, meta: { error: 'invalid component metadata' } }])).props.open).toBe(true)
  })
})
