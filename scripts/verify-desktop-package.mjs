import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, process.argv[2] ?? '.pack/desktop')
const resources = resolve(output, 'win-unpacked', 'resources')
const executable = resolve(output, 'DSH Editor-0.1.0-win-x64.exe')

async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }

async function treeDigest(path) {
  const hash = createHash('sha256')
  let files = 0
  let bytes = 0
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const absolute = resolve(dir, entry.name)
      if (entry.isDirectory()) { await visit(absolute); continue }
      if (!entry.isFile()) continue
      const data = await readFile(absolute)
      hash.update(relative(path, absolute).replaceAll('\\', '/'))
      hash.update('\0')
      hash.update(createHash('sha256').update(data).digest('hex'))
      hash.update('\n')
      files += 1
      bytes += data.byteLength
    }
  }
  await visit(path)
  return { sha256: hash.digest('hex'), files, bytes }
}

const manifest = await json(resolve(resources, 'runtime-manifest.json'))
const actual = {
  node: await treeDigest(resolve(resources, 'node')),
  dsh: await treeDigest(resolve(resources, 'dsh')),
  profile: await treeDigest(resolve(resources, 'profile-template')),
}
for (const key of ['node', 'dsh', 'profile']) {
  for (const field of ['sha256', 'files', 'bytes']) {
    if (actual[key][field] !== manifest[key][field]) throw new Error(`${key} ${field} mismatch`)
  }
}
const dsh = await json(resolve(resources, 'dsh', 'package.json'))
if (dsh.name !== '@deepseek-ai/dsh' || dsh.version !== '0.1.1-rc.2') throw new Error('packaged DSH identity mismatch')
for (const packageName of ['dsh-manuscript', 'dsh-editor-workbench', 'dsh-editor-novel-kernel', 'dsh-editor-shell']) {
  await stat(resolve(resources, 'profile-template', 'node_modules', packageName, 'package.json'))
}
const knowledgeRoot = resolve(resources, 'profile-template', 'node_modules', 'dsh-editor-novel-kernel', 'resources', 'novel-knowledge')
for (const fileName of [
  'planning.md', 'characters.md', 'drafting.md', 'dialogue.md', 'interiority.md',
  'style.md', 'review.md', 'chinese-flow.md', 'first-reader.md', 'canon.md', 'SOURCES.md',
]) {
  await stat(resolve(knowledgeRoot, fileName))
}
try {
  await stat(resolve(resources, 'profile-template', 'node_modules', 'dsh-grill'))
  throw new Error('desktop profile must not contain dsh-grill')
} catch (error) {
  if (error instanceof Error && error.message === 'desktop profile must not contain dsh-grill') throw error
  if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
}
const nodeProbe = spawnSync(resolve(resources, 'node', 'node.exe'), ['--version'], { encoding: 'utf8', windowsHide: true })
if (nodeProbe.status !== 0 || nodeProbe.stdout.trim() !== 'v24.16.0') throw new Error('packaged Node probe failed')
const executableBytes = (await stat(executable)).size
const executableSha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
const report = { ok: true, source: 'current', executable, executableBytes, executableSha256, manifest, actual }
await writeFile(resolve(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
