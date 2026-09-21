import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
it('uses the current manifest identity when a pre-rename watcher passes the directory name', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-scoped-wrapper-'))
  mkdirSync(join(cwd, 'lib'))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: '@klarkxy/dsh-zhihu' }))
  writeFileSync(join(cwd, 'lib/client.inner.cjs'), 'module.exports = {}')
  const run = name => spawnSync(process.execPath, [resolve('scripts/wrap-client.mjs'), name], { cwd, encoding: 'utf8', windowsHide: true })
  expect(run('dsh-zhihu').status).toBe(0)
  expect(readFileSync(join(cwd, 'lib/client.js'), 'utf8')).toContain('id: "@klarkxy/dsh-zhihu"')
  expect(run('unrelated').status).not.toBe(0)
})
