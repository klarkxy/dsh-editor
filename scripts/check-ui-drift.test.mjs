import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkWorkingTree, findings, isUiSource, regressions } from './check-ui-drift.mjs'

const path = 'packages/dsh-editor-shell/src/client/example.tsx'
test('covers shell, plugin and app UI, but not tests or generated files', () => {
  for (const p of [path, 'packages/dsh-proofread/src/client.ts', 'packages/plugin/src/panel.tsx', 'apps/desktop/src/theme.ts', 'packages/plugin/src/styles.css']) assert(isUiSource(p), p)
  for (const p of ['docs/guide.md', 'packages/plugin/src/test.spec.tsx', 'packages/plugin/lib/client.js', 'packages/plugin/fixtures/ui.tsx', 'packages/dsh-editor-shell/src/design-system/tokens.ts', 'packages/dsh-editor-shell/src/design-system/styles.ts']) assert(!isUiSource(p), p)
})
test('tokens, Radix props and structural values are allowed', () => {
  assert.deepEqual(findings(`<Button color="red" size="2" />
    const style = { color: 'var(--dsh-ui-text)', borderRadius: 'var(--dsh-ui-radius-md)', minWidth: 0 };
    .row { border: 1px solid var(--dsh-ui-line); z-index: 0; border-radius: 0; }`), [])
})
test('literal colors, radii, type, stacking, shadows and decorative effects fail', () => {
  const found = findings(`.card { color: #777777; background: rgb(1 2 3 / 20%);
    border-radius: 11px; font-size: 15px; font-weight: 550; z-index: 9999;
    box-shadow: 0 2px 4px black; background-image: linear-gradient(red, blue);
    backdrop-filter: blur(8px); color: red !important; }
    const style = { borderRadius: 13, fontSize: '15px', zIndex: 400 };`)
  for (const rule of ['literal-color', 'literal-scale', 'literal-shadow', 'decorative-effect', 'cascade-override']) assert(found.some(f => f.rule === rule), rule)
})
test('comments and long hashes do not become colors; diagnostic line stays correct', () => {
  const source = `/* color #ffffff\n gradient linear-gradient( */\n// #aaaaaa\nconst commit = 'abc123456789';\n.x { color: #123456; }`
  assert.equal(findings(source).length, 1)
  assert.equal(findings(source)[0].line, 5)
})
test('unchanged legacy literals pass, duplication and replacement do not', () => {
  const before = '.x { color: #ffffff; }'
  assert.deepEqual(regressions(before, before), [])
  assert.equal(regressions(before, before + before).length, 1)
  assert.equal(regressions(before, '.x { color: #000000; }').length, 1)
  assert.deepEqual(regressions(before, '.x { color: var(--dsh-ui-text); }'), [])
})

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-ui-drift-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q'); git('config', 'user.name', 'UI guard test'); git('config', 'user.email', 'ui-test@example.invalid')
  const write = (p, text) => { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), text) }
  write(path, '.x { color: #ffffff; }\n')
  git('add', '.'); git('commit', '-qm', 'baseline')
  return { cwd, git, write, base: git('rev-parse', 'HEAD') }
}
test('includes staged, unstaged, and untracked files with spaces', t => {
  const { cwd, git, write, base } = repository(t)
  write(path, '.x { color: #ffffff; color: #111111; }'); git('add', '.')
  write(path, '.x { color: #ffffff; color: #111111; color: #222222; }')
  write('packages/plugin/src/new panel.tsx', "const s = { color: '#333333' }")
  const report = checkWorkingTree({ cwd, base })
  assert.equal(report.files, 2); assert.equal(report.issues.length, 3)
})
test('explicit head checks committed content, not uncommitted edits', t => {
  const { cwd, git, write, base } = repository(t)
  write(path, '.x { color: #000000; }'); git('add', '.'); git('commit', '-qm', 'new literal')
  write(path, '.x { color: var(--dsh-ui-text); }')
  assert.equal(checkWorkingTree({ cwd, base, head: 'HEAD' }).issues.length, 1)
  assert.equal(checkWorkingTree({ cwd, base }).issues.length, 0)
})
test('renames cannot launder legacy literals; deleted files do not fail', t => {
  const { cwd, git, base } = repository(t)
  renameSync(join(cwd, path), join(cwd, path.replace('example', 'renamed'))); git('add', '-A')
  assert.equal(checkWorkingTree({ cwd, base }).issues.length, 1)
  rmSync(join(cwd, path.replace('example', 'renamed'))); git('add', '-A')
  assert.equal(checkWorkingTree({ cwd, base }).issues.length, 0)
})
test('missing or invalid base is an error, not a successful skip', t => {
  const { cwd } = repository(t)
  assert.throws(() => checkWorkingTree({ cwd }), /Supply --base/)
  assert.throws(() => checkWorkingTree({ cwd, base: 'missing-ref' }), /NOT skipped/)
})
