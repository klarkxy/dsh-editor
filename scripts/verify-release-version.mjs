import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

export function readDesktopVersion(root = repoRoot) {
  const pkgPath = resolve(root, 'apps/desktop/package.json')
  let raw
  try {
    raw = readFileSync(pkgPath, 'utf8')
  } catch (error) {
    throw new Error(`failed to read apps/desktop/package.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch (error) {
    throw new Error(`apps/desktop/package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const version = pkg?.version
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('apps/desktop/package.json is missing a version')
  }
  return version
}

export function expectedReleaseTag(version) {
  return `v${version}`
}

export function assertReleaseTag(tag, version) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('desktop version is missing')
  }
  if (tag === undefined || tag === null || String(tag).trim() === '') {
    throw new Error('release tag is missing')
  }
  const actual = String(tag)
  const expected = expectedReleaseTag(version)
  if (actual !== expected) {
    throw new Error(`release tag ${JSON.stringify(actual)} does not match ${JSON.stringify(expected)}`)
  }
  return expected
}

function launchedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(entry) === fileURLToPath(import.meta.url)
}

function main() {
  try {
    const version = readDesktopVersion()
    const matched = assertReleaseTag(process.argv[2], version)
    process.stdout.write(`${matched}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (launchedAsCli()) main()
