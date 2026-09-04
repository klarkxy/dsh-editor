import { spawnSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH_REPO = 'deepseek-ai/deepseek-harness'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const PINNED_PACKAGES = [
  DSH_PACKAGE,
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-credentials',
]
const LOCKFILE = 'pnpm-lock.yaml'
const SKIP_DIRS = new Set(['.git', 'node_modules', '.pack', '.pnpm-store', '.dev', '.playwright-mcp', 'dist', 'lib', 'out'])

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshCliPath = resolve(root, 'scripts', 'dsh-cli.mjs')

function usage() {
  console.log(`usage: node scripts/upgrade-dsh.mjs [options]

Upgrade the pinned DSH version across the repository.

options:
  --to <version>      upgrade to an explicit version (e.g. 0.1.2-rc.1)
  --channel <name>    release channel for auto resolution: rc (default) | alpha
  --dry-run           only print what would change
  --skip-install      do not run pnpm install after rewriting pins
  --skip-global       do not npm install -g ${DSH_PACKAGE} after rewriting pins`)
}

function parseArgs(argv) {
  const options = { channel: 'rc' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--to') options.to = argv[++i]
    else if (arg === '--channel') options.channel = argv[++i]
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--skip-install') options.skipInstall = true
    else if (arg === '--skip-global') options.skipGlobal = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.channel !== 'rc' && options.channel !== 'alpha') {
    throw new Error(`unsupported channel: ${options.channel}`)
  }
  return options
}

function normalizeVersion(input) {
  const match = String(input).trim().match(/^(?:dsh-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)
  if (!match) throw new Error(`not a DSH version: ${input}`)
  return match[1]
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  return { major: +match[1], minor: +match[2], patch: +match[3], pre: match[4] ?? null }
}

function compareSemver(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (a.pre === b.pre) return 0
  if (a.pre === null) return 1
  if (b.pre === null) return -1
  const pa = a.pre.split('.')
  const pb = b.pre.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = /^\d+$/.test(pa[i]) ? +pa[i] : null
    const nb = /^\d+$/.test(pb[i]) ? +pb[i] : null
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb
      continue
    }
    if (na !== null) return -1
    if (nb !== null) return 1
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

async function currentVersion() {
  const source = await readFile(dshCliPath, 'utf8')
  const match = source.match(/EXPECTED_DSH_VERSION\s*=\s*'([^']+)'/)
  if (!match) throw new Error(`EXPECTED_DSH_VERSION not found in ${dshCliPath}`)
  return match[1]
}

function listGhReleases() {
  const result = spawnSync('gh', [
    'release', 'list', '--repo', DSH_REPO,
    '--json', 'tagName,isPrerelease', '--limit', '50',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) {
    throw new Error(`gh release list failed (install and authenticate the gh CLI, or pass --to): ${result.error?.message || result.stderr}`)
  }
  return JSON.parse(result.stdout)
}

function candidateVersions(channel) {
  return listGhReleases()
    .map((release) => {
      try { return normalizeVersion(release.tagName) } catch { return null }
    })
    .filter(Boolean)
    .filter((version) => {
      if (channel === 'alpha') return true
      const { pre } = parseSemver(version)
      return pre === null || pre.split('.')[0] === 'rc'
    })
    .sort((a, b) => compareSemver(parseSemver(b), parseSemver(a)))
}

async function npmHasVersion(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`)
  return response.status === 200
}

async function installable(version) {
  const checks = await Promise.all(PINNED_PACKAGES.map((name) => npmHasVersion(name, version)))
  return checks.every(Boolean)
}

async function resolveTarget(options, current) {
  if (options.to) {
    const target = normalizeVersion(options.to)
    if (!(await installable(target))) {
      throw new Error(`${target} is not fully published on npm for: ${PINNED_PACKAGES.join(', ')}`)
    }
    return target
  }
  const candidates = candidateVersions(options.channel)
  if (candidates.length === 0) {
    throw new Error(`no ${DSH_REPO} releases found on channel ${options.channel}`)
  }
  for (const candidate of candidates) {
    if (candidate === current) return candidate
    if (await installable(candidate)) return candidate
    console.log(`skipping ${candidate}: not fully published on npm`)
  }
  return current
}

async function listFilesContaining(oldVersion) {
  const result = spawnSync('git', ['grep', '-l', '-F', oldVersion], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (!result.error && (result.status === 0 || result.status === 1)) {
    return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line && line !== LOCKFILE)
  }

  const files = []
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(resolve(dir, entry.name))
        continue
      }
      if (!entry.isFile() || entry.name === LOCKFILE) continue
      const absolute = resolve(dir, entry.name)
      const content = await readFile(absolute, 'utf8').catch(() => null)
      if (content !== null && content.includes(oldVersion)) files.push(relative(root, absolute))
    }
  }
  await visit(root)
  return files
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true, windowsHide: true })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? result.error?.message}`)
  }
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  usage()
  process.exit(0)
}

const current = await currentVersion()
const target = await resolveTarget(options, current)
console.log(`current DSH version: ${current}`)
console.log(`target DSH version:  ${target}`)

if (target === current) {
  console.log('already at the latest installable release, nothing to do')
  process.exit(0)
}

const files = await listFilesContaining(current)
if (files.length === 0) {
  throw new Error(`no tracked files contain ${current}; is the repository in a partial state?`)
}

let totalReplacements = 0
for (const file of files) {
  const absolute = resolve(root, file)
  const content = await readFile(absolute, 'utf8')
  const count = content.split(current).length - 1
  totalReplacements += count
  console.log(`${options.dryRun ? 'would update' : 'update'} ${file} (${count} occurrence${count === 1 ? '' : 's'})`)
  if (!options.dryRun) {
    await writeFile(absolute, content.split(current).join(target))
  }
}
console.log(`${options.dryRun ? 'would replace' : 'replaced'} ${totalReplacements} occurrences across ${files.length} files`)

if (options.dryRun) {
  process.exit(0)
}

if (!options.skipInstall) {
  run('pnpm', ['install'])
}
if (!options.skipGlobal) {
  run('npm', ['install', '-g', `${DSH_PACKAGE}@${target}`])
}

const { resolveDshInstallation } = await import(`${pathToFileURL(dshCliPath).href}?t=${Date.now()}`)
const resolved = resolveDshInstallation(target)
console.log(`resolved ${DSH_PACKAGE}@${resolved.version} from ${resolved.source}: ${resolved.packageRoot}${sep}`)
console.log('next steps: pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e:desktop && pnpm test:e2e:core-loop')
