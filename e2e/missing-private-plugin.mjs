import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = resolve(root, '.dev')
const packRoot = resolve(root, '.pack')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')
resolveDshInstallation('0.1.1-rc.2')

function waitForExit(child, timeoutMs) {
  return Promise.race([
    new Promise((resolvePromise, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolvePromise({ code, signal, timedOut: false }))
    }),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise({ code: null, signal: null, timedOut: true }), timeoutMs)),
  ])
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ])
}

async function probeMissing(packageName) {
  const sandbox = await mkdtemp(resolve(devRoot, `missing-${packageName}-`))
  if (!sandbox.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe negative-smoke path: ${sandbox}`)
  const damagedTemplate = resolve(sandbox, 'template')
  const home = resolve(sandbox, 'home')
  let child
  try {
    await cp(template, damagedTemplate, { recursive: true })
    await rm(resolve(damagedTemplate, 'node_modules', packageName), { recursive: true, force: true })
    await deployProfile(home, damagedTemplate, resolve(runtime, 'node_modules'))
    const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
    delete env.DEEPSEEK_API_KEY
    delete env.DSH_EDITOR_CUSTOM_API_KEY
    child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    const exited = await waitForExit(child, 30_000)
    if (exited.timedOut) throw new Error(`${packageName}: DSH did not fail within 30 seconds`)
    if (/https?:\/\/127\.0\.0\.1:\d+/.test(output)) throw new Error(`${packageName}: DSH became ready without a required private plugin`)
    if (exited.code === 0) throw new Error(`${packageName}: DSH exited successfully despite the missing required plugin`)
    const tail = output.slice(-4_000)
    if (!tail.includes(packageName)) throw new Error(`${packageName}: failure did not identify the missing package: ${tail}`)
    return { packageName, exitCode: exited.code, signal: exited.signal, failure: tail }
  } finally {
    if (child) await stop(child)
    await rm(sandbox, { recursive: true, force: true })
  }
}

await mkdir(packRoot, { recursive: true })
const results = []
for (const packageName of ['dsh-editor-workbench', 'dsh-editor-novel-kernel']) results.push(await probeMissing(packageName))
const report = { ok: true, dsh: '0.1.1-rc.2', results }
await writeFile(resolve(packRoot, 'missing-private-plugin-smoke.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ok: true, dsh: report.dsh, results: results.map(({ packageName, exitCode }) => ({ packageName, exitCode })) }, null, 2))
