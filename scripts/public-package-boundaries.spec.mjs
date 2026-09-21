import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')
const PRODUCTION_FIELDS = ['dependencies', 'optionalDependencies']
const SEAT_CONSUMERS = ['dsh-manuscript', '@klarkxy/dsh-zhihu']

function loadWorkspacePackages() {
  const packages = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const pkg = JSON.parse(readFileSync(join(packagesDir, entry.name, 'package.json'), 'utf8'))
      if (pkg && typeof pkg.name === 'string' && pkg.name) packages.push(pkg)
    } catch {
      continue
    }
  }
  return packages
}

function isPrivateOrDesktop(pkg) {
  return pkg.private === true || pkg.dshEditor?.visibility === 'desktop'
}

describe('public package distribution boundaries', () => {
  const workspace = loadWorkspacePackages()
  const byName = new Map(workspace.map((pkg) => [pkg.name, pkg]))
  const publicPackages = workspace.filter((pkg) => pkg.dshEditor?.visibility === 'public')

  it('does not publish production deps on private or desktop workspace packages', () => {
    const violations = []
    for (const pkg of publicPackages) {
      for (const field of PRODUCTION_FIELDS) {
        for (const name of Object.keys(pkg[field] ?? {})) {
          const target = byName.get(name)
          if (target && isPrivateOrDesktop(target)) {
            violations.push(`${pkg.name} ${field} -> ${name}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps dsh-editor-seats as a workspace:* devDependency on packages that inline it', () => {
    for (const name of SEAT_CONSUMERS) {
      const pkg = byName.get(name)
      expect(pkg, name).toBeTruthy()
      expect(pkg.dshEditor?.visibility, name).toBe('public')
      expect(pkg.devDependencies?.['dsh-editor-seats'], name).toBe('workspace:*')
      expect(pkg.dependencies?.['dsh-editor-seats'], name).toBeUndefined()
      expect(pkg.optionalDependencies?.['dsh-editor-seats'], name).toBeUndefined()
    }
  })
})
