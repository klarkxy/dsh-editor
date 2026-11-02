import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { resolveDshInstallation } from './dsh-cli.mjs'

let temp
afterEach(() => {
  vi.unstubAllEnvs()
  if (temp) rmSync(temp, { recursive: true, force: true })
  temp = undefined
})

function fixture(version = '0.2.1-rc.5') {
  temp = mkdtempSync(join(tmpdir(), 'dsh-cli-physical-'))
  const physical = join(temp, 'store', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(physical, 'lib'), { recursive: true })
  writeFileSync(join(physical, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  writeFileSync(join(physical, 'lib', 'bin.js'), '')
  const dependency = join(temp, 'store', 'node_modules', 'physical-dependency')
  mkdirSync(dependency, { recursive: true })
  writeFileSync(join(dependency, 'index.js'), "module.exports = 'physical dependency'\n")
  const alias = join(temp, 'workspace', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(temp, 'workspace', 'node_modules', '@deepseek-ai'), { recursive: true })
  symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
  vi.stubEnv('DSH_CLI_PATH', join(alias, 'lib', 'bin.js'))
  return { alias, physical }
}

describe('DSH installation physical module root', () => {
  it('resolves dependencies from the physical pnpm package behind a junction', () => {
    const { physical } = fixture()
    const installation = resolveDshInstallation()
    expect(installation.packageRoot).toBe(realpathSync(physical))
    expect(installation.cliPath).toBe(join(realpathSync(physical), 'lib', 'bin.js'))
    expect(installation.source).toBe('DSH_CLI_PATH')
    const require = createRequire(join(installation.packageRoot, 'package.json'))
    expect(require('physical-dependency')).toBe('physical dependency')
  })

  it('keeps the pinned-version rejection before returning a physical root', () => {
    fixture('0.1.0')
    expect(() => resolveDshInstallation()).toThrow('DSH version mismatch: expected 0.2.1-rc.5, found 0.1.0')
  })

  it('rejects a missing explicitly configured CLI without falling back to PATH', () => {
    fixture()
    vi.stubEnv('DSH_CLI_PATH', join(temp, 'missing-package', 'lib', 'bin.js'))
    expect(() => resolveDshInstallation()).toThrow('DSH_CLI_PATH does not point to an installed')
  })
})
