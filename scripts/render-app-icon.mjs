import { copyFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePng = resolve(root, 'apps', 'desktop', 'build', 'icon-source.png')
const png = resolve(root, 'apps', 'desktop', 'build', 'icon.png')
const ico = resolve(root, 'apps', 'desktop', 'build', 'icon.ico')
const shellIcon = resolve(root, 'packages', 'dsh-editor-shell', 'src', 'client', 'assets', 'app-icon.webp')

// Keep OS icons faithful to the original artwork, including its transparency.
await copyFile(sourcePng, png)

const pillow = String.raw`
from PIL import Image
import sys
source, target, shell_icon = sys.argv[1:]
with Image.open(source) as image:
    image.save(target, format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
    image.save(shell_icon, format='WEBP', lossless=True)
`
const converted = spawnSync('python', ['-c', pillow, png, ico, shellIcon], { stdio: 'inherit', windowsHide: true })
if (converted.status !== 0) throw new Error(`ICO conversion failed with exit code ${converted.status ?? 'unknown'}`)

console.log(`desktop icon: ${png}`)
console.log(`desktop icon: ${ico}`)
console.log(`shell icon: ${shellIcon}`)
