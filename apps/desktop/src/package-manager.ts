import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, delimiter } from 'node:path'

/** Packaged and development plugin operations use this exact pnpm, not the repo build pin. */
export const PINNED_PNPM_VERSION = '11.7.0'
const PINNED_PNPM_NAME = 'pnpm'
const PNPM_ENTRIES = ['bin/pnpm.mjs', 'bin/pnpm.cjs', 'bin/pnpm.js', 'dist/pnpm.cjs'] as const

export type BundledPackageManager = {
  command: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
}

function readPnpmManifest(packageRoot: string): { name: unknown; version: unknown } {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name: unknown; version: unknown }
}

export function assertPinnedPnpm(packageRoot: string): void {
  const manifest = readPnpmManifest(packageRoot)
  if (manifest.name !== PINNED_PNPM_NAME || manifest.version !== PINNED_PNPM_VERSION) {
    throw new Error(`Expected ${PINNED_PNPM_NAME}@${PINNED_PNPM_VERSION}, found ${String(manifest.name)}@${String(manifest.version)} at ${packageRoot}`)
  }
}

export function resolvePnpmEntry(packageRoot: string): string {
  for (const relative of PNPM_ENTRIES) {
    const path = join(packageRoot, ...relative.split('/'))
    if (existsSync(path)) return path
  }
  throw new Error(`Bundled pnpm is missing an executable entry in ${packageRoot}`)
}

/**
 * Resolve the workspace alias `desktop-pnpm` (npm:pnpm@11.7.0).
 * pnpm 11.7.0 exports `"."` as `./package.json` and does not export the
 * `./package.json` subpath, so the requested resolve is tried first.
 */
export function resolveDesktopPnpmManifest(from: string | URL = import.meta.url): string {
  const require = createRequire(from)
  try {
    return require.resolve('desktop-pnpm/package.json')
  } catch (error) {
    const resolved = require.resolve('desktop-pnpm')
    if (resolved.endsWith('package.json')) return resolved
    throw error
  }
}

export function resolveDesktopPnpmPackage(from: string | URL = import.meta.url): string {
  const packageRoot = dirname(resolveDesktopPnpmManifest(from))
  assertPinnedPnpm(packageRoot)
  return packageRoot
}

function relocatedPnpmRoot(nodePath: string): string | undefined {
  const packageRoot = join(dirname(nodePath), 'node_modules', 'pnpm')
  return existsSync(join(packageRoot, 'package.json')) ? packageRoot : undefined
}

function pathWithNodeFirst(nodePath: string, env: NodeJS.ProcessEnv): string {
  const nodeDir = dirname(nodePath)
  const inherited = env.PATH ?? env.Path ?? ''
  return inherited ? `${nodeDir}${delimiter}${inherited}` : nodeDir
}

/** Stop pnpm 11 from auto-switching to an ancestor packageManager pin (the Editor build uses 10.14.0). Direct CLI flag; `--config.*` and npm_config variants still switch. */
export const PINNED_PNPM_CLI_FLAGS = ['--pm-on-fail=ignore'] as const

function packageOperationEnv(nodePath: string, env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    PATH: pathWithNodeFirst(nodePath, env),
  }
}

/** Packaged Node uses the relocated copy; development uses the pinned desktop-pnpm alias. */
export function resolveBundledPackageManager(nodePath: string, env: NodeJS.ProcessEnv = process.env): BundledPackageManager {
  const relocated = relocatedPnpmRoot(nodePath)
  const packageRoot = relocated ?? resolveDesktopPnpmPackage()
  assertPinnedPnpm(packageRoot)
  return {
    command: nodePath,
    args: [resolvePnpmEntry(packageRoot), ...PINNED_PNPM_CLI_FLAGS],
    env: packageOperationEnv(nodePath, env),
  }
}
