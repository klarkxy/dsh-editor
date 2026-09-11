import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  assertReleaseTag,
  expectedReleaseTag,
  readDesktopVersion,
} from './verify-release-version.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = resolve(root, 'scripts/verify-release-version.mjs')

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
}

describe('assertReleaseTag', () => {
  it('accepts a tag that is exactly v plus the desktop version', () => {
    expect(assertReleaseTag('v0.1.8', '0.1.8')).toBe('v0.1.8')
    expect(expectedReleaseTag('1.2.3')).toBe('v1.2.3')
  })

  it('rejects a tag that does not strictly equal v${version}', () => {
    expect(() => assertReleaseTag('v0.1.7', '0.1.8')).toThrow(/does not match/)
    expect(() => assertReleaseTag('0.1.8', '0.1.8')).toThrow(/does not match/)
    expect(() => assertReleaseTag('V0.1.8', '0.1.8')).toThrow(/does not match/)
    expect(() => assertReleaseTag('v0.1.8 ', '0.1.8')).toThrow(/does not match/)
    expect(() => assertReleaseTag('vv0.1.8', '0.1.8')).toThrow(/does not match/)
  })

  it('rejects a missing or blank tag', () => {
    expect(() => assertReleaseTag(undefined, '0.1.8')).toThrow(/missing/)
    expect(() => assertReleaseTag(null, '0.1.8')).toThrow(/missing/)
    expect(() => assertReleaseTag('', '0.1.8')).toThrow(/missing/)
    expect(() => assertReleaseTag('   ', '0.1.8')).toThrow(/missing/)
  })
})

describe('readDesktopVersion', () => {
  it('reads the workspace desktop package version', () => {
    const version = readDesktopVersion(root)
    const pkg = JSON.parse(readFileSync(resolve(root, 'apps/desktop/package.json'), 'utf8'))
    expect(version).toBe(pkg.version)
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('rejects a desktop package without a version field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-release-'))
    try {
      mkdirSync(join(dir, 'apps', 'desktop'), { recursive: true })
      writeFileSync(join(dir, 'apps', 'desktop', 'package.json'), `${JSON.stringify({ name: '@dsh-editor/desktop' })}\n`)
      expect(() => readDesktopVersion(dir)).toThrow(/missing a version/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verify-release-version CLI', () => {
  const version = readDesktopVersion(root)
  const tag = expectedReleaseTag(version)

  it('exits 0 when argv[2] is v plus the desktop version', () => {
    const result = runCli([tag])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(tag)
    expect(result.stderr).toBe('')
  })

  it('exits non-zero when the tag does not match', () => {
    const result = runCli(['v0.0.0'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/does not match/)
    expect(result.stderr).toContain(tag)
  })

  it('exits non-zero when the tag is missing', () => {
    const result = runCli([])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/missing/)
  })

  it('exits non-zero when the tag omits the v prefix', () => {
    const result = runCli([version])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/does not match/)
  })
})
