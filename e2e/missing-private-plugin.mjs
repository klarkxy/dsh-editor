import { workspacePackageDir } from '../scripts/desktop-compositions.mjs'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'
import { loadPluginManifests } from '../scripts/plugin-manifest.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = resolve(root, '.dev')
const workRoot = resolve(devRoot, 'missing-plugin-repair')
const packRoot = resolve(root, '.pack')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime-0.1.7-alpha.1')
const sharedCli = resolve(runtime, 'lib', 'bin.js')
const READY = /https?:\/\/127\.0\.0\.1:\d+/
resolveDshInstallation('0.1.7-alpha.1')

function assertInside(path, boundary) {
  const resolved = resolve(path)
  if (resolved !== boundary && !resolved.startsWith(`${boundary}${sep}`)) {
    throw new Error(`unsafe negative-smoke path: ${resolved}`)
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function packageHits(anchor, packageName) {
  if (!existsSync(anchor)) return []
  const hits = []
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) hits.push(candidate)
  }
  return hits
}

function assertUnresolved(packageName, anchors, label) {
  for (const anchor of anchors) {
    const hits = packageHits(anchor, packageName)
    if (hits.length) {
      throw new Error(`${label}: ${packageName} still resolves from ${anchor}: ${hits.join(', ')}`)
    }
  }
}

function assertProtected(packageName) {
  if (!existsSync(join(workspacePackageDir(packageName), 'package.json'))) {
    throw new Error(`probe deleted source package ${packageName}`)
  }
  if (!existsSync(join(runtime, 'node_modules', packageName))) {
    throw new Error(`probe deleted shared runtime package ${packageName}`)
  }
}

function dshEnv(home) {
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  delete env.DEEPSEEK_API_KEY
  delete env.DSH_EDITOR_CUSTOM_API_KEY
  delete env.NODE_PATH
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function copyTreeOmitting(source, target, omit) {
  await mkdir(target, { recursive: true })
  for (const name of await readdir(source)) {
    const from = join(source, name)
    const to = join(target, name)
    if (omit && resolve(from) === omit) continue
    const info = await lstat(from)
    if (info.isSymbolicLink()) {
      const real = await realpath(from)
      await symlink(real, to, (await stat(real)).isDirectory() ? 'junction' : 'file')
      continue
    }
    if (info.isDirectory()) {
      await copyTreeOmitting(from, to, omit)
      continue
    }
    await copyFile(from, to)
  }
}

async function cloneRuntimeOmitting(source, target, omitName) {
  await mkdir(target, { recursive: true })
  for (const name of await readdir(source)) {
    if (name === 'node_modules') continue
    const from = join(source, name)
    const to = join(target, name)
    const info = await lstat(from)
    if (info.isDirectory()) {
      await copyTreeOmitting(from, to)
      continue
    }
    await copyFile(from, to)
  }
  const modulesFrom = join(source, 'node_modules')
  const modulesTo = join(target, 'node_modules')
  await mkdir(modulesTo, { recursive: true })
  for (const name of await readdir(modulesFrom)) {
    if (name === omitName) continue
    const from = join(modulesFrom, name)
    const to = join(modulesTo, name)
    const info = await lstat(from)
    if (info.isSymbolicLink() || info.isDirectory()) {
      await symlink(await realpath(from), to, 'junction')
      continue
    }
    await copyFile(from, to)
  }
}

async function rmSandbox(sandbox) {
  assertInside(sandbox, workRoot)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(sandbox, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 5) throw error
      await delay(200 * (attempt + 1))
    }
  }
}

async function stop(child) {
  if (!child || child.pid == null || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolvePromise())
      killer.once('exit', () => resolvePromise())
    })
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    delay(3_000),
  ])
  if (child.exitCode !== null) return
  child.kill('SIGKILL')
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    delay(1_000),
  ])
}

function attachOutput(child) {
  let output = ''
  const collect = (chunk) => { output += String(chunk) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return () => output
}

function waitForExit(child, timeoutMs) {
  return Promise.race([
    new Promise((resolvePromise, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolvePromise({ code, signal, timedOut: false }))
    }),
    delay(timeoutMs).then(() => ({ code: null, signal: null, timedOut: true })),
  ])
}

function waitForReady(child, read, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const finish = (result) => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
      resolvePromise(result)
    }
    const onData = () => {
      if (READY.test(read())) finish({ ready: true, timedOut: false })
    }
    const onError = reject
    const onExit = (code, signal) => finish({ ready: READY.test(read()), timedOut: false, code, signal })
    const timer = setTimeout(() => finish({ ready: READY.test(read()), timedOut: !READY.test(read()) }), timeoutMs)
    child.once('error', onError)
    child.once('exit', onExit)
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    onData()
  })
}

function formatOutput(output) {
  const tail = output.slice(-8_000)
  return tail.trim() ? tail : '(no stdout/stderr captured)'
}

async function withSandbox(prefix, run) {
  await mkdir(workRoot, { recursive: true })
  const sandbox = await mkdtemp(resolve(workRoot, `${prefix}-`))
  assertInside(sandbox, workRoot)
  let child
  try {
    return await run(sandbox, (spawned) => { child = spawned })
  } finally {
    await stop(child)
    await rmSandbox(sandbox)
  }
}

async function probeHealthy() {
  return withSandbox('healthy', async (sandbox, track) => {
    const home = resolve(sandbox, 'home')
    await deployProfile(home, template, resolve(runtime, 'node_modules'))
    const child = spawn(process.execPath, [sharedCli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: sandbox,
      env: dshEnv(home),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    track(child)
    const read = attachOutput(child)
    const started = await waitForReady(child, read, 60_000)
    const output = read()
    if (!started.ready) {
      const reason = started.timedOut ? 'did not become ready within 60 seconds' : `exited ${started.code} before ready`
      throw new Error(`healthy profile: DSH ${reason}\n--- output ---\n${formatOutput(output)}`)
    }
    return { ok: true, pid: child.pid }
  })
}

async function probeMissing(packageName) {
  assertProtected(packageName)
  return withSandbox(`missing-${packageName}`, async (sandbox, track) => {
    const damagedTemplate = resolve(sandbox, 'template')
    const isolatedRuntime = resolve(sandbox, 'runtime')
    const home = resolve(sandbox, 'home')
    await copyTreeOmitting(template, damagedTemplate, resolve(template, 'node_modules', packageName))
    await cloneRuntimeOmitting(runtime, isolatedRuntime, packageName)
    if (existsSync(join(damagedTemplate, 'node_modules', packageName))) {
      throw new Error(`${packageName}: damaged template still contains the package`)
    }
    if (existsSync(join(isolatedRuntime, 'node_modules', packageName))) {
      throw new Error(`${packageName}: isolated runtime still contains the package`)
    }
    assertProtected(packageName)
    assertUnresolved(packageName, [
      join(isolatedRuntime, 'package.json'),
      join(damagedTemplate, 'package.json'),
    ], `${packageName}: before deploy`)
    let failure
    try {
      await deployProfile(home, damagedTemplate, join(isolatedRuntime, 'node_modules'))
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (!failure?.includes(packageName)) throw new Error(`${packageName}: deployment did not reject the missing required package: ${failure ?? 'no error'}`)
    if (existsSync(join(home, 'profiles', 'dsh-editor'))) throw new Error(`${packageName}: missing package check touched the user profile`)
    assertProtected(packageName)
    return { packageName, failure }
  })
}

await mkdir(packRoot, { recursive: true })
const privateHosts = loadPluginManifests(root)
  .filter((item) => item.visibility === 'desktop' && !item.wrapClient)
  .map((item) => item.name)
if (!privateHosts.length) throw new Error('no private host plugins declared')
const healthy = await probeHealthy()
const results = []
for (const packageName of privateHosts) results.push(await probeMissing(packageName))
const report = { ok: true, dsh: '0.1.7-alpha.1', healthy, results }
await writeFile(resolve(packRoot, 'missing-private-plugin-smoke.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  ok: true,
  dsh: report.dsh,
  healthy: { ok: healthy.ok },
  results: results.map(({ packageName, failure }) => ({ packageName, failure })),
}, null, 2))
