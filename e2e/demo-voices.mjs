/**
 * Synthesize demo voiceover clips with MiniMax speech-2.8-hd.
 * Default voice: Chinese (Mandarin)_Crisp_Girl
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { readdir, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const voDir = resolve(root, 'e2e', 'demo', 'vo')
const outDir = resolve(root, 'e2e', 'out', 'demo', 'vo')
const voice = process.env.E2E_DEMO_VOICE || 'Chinese (Mandarin)_Crisp_Girl'
const model = process.env.E2E_DEMO_SPEECH_MODEL || 'speech-2.8-hd'

await mkdir(outDir, { recursive: true })

const files = (await readdir(voDir)).filter((name) => name.endsWith('.txt')).sort()
if (!files.length) throw new Error('no vo text files')

const mmxCli = process.env.MMX_CLI_PATH
  || resolve(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'mmx-cli', 'dist', 'mmx.mjs')

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [mmxCli, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`mmx exited ${code}: ${args.join(' ')}`)))
  })
}

for (const name of files) {
  const stem = name.replace(/\.txt$/, '')
  const textFile = resolve(voDir, name)
  const out = resolve(outDir, `${stem}.mp3`)
  console.log(`[demo-voices] ${stem} → ${voice}`)
  await run([
    'speech', 'synthesize',
    '--non-interactive',
    '--quiet',
    '--model', model,
    '--voice', voice,
    '--language', 'Chinese',
    '--speed', '1.05',
    '--text-normalization',
    '--subtitles',
    '--text-file', textFile,
    '--out', out,
  ])
}

console.log(`[demo-voices] wrote ${files.length} clips to ${outDir}`)
