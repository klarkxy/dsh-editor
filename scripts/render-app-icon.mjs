import { copyFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePng = resolve(root, 'apps', 'desktop', 'build', 'icon-source.png')
const png = resolve(root, 'apps', 'desktop', 'build', 'icon.png')
const ico = resolve(root, 'apps', 'desktop', 'build', 'icon.ico')

// Keep OS icons faithful to the original artwork, including its transparency.
await copyFile(sourcePng, png)

const pillow = String.raw`
from PIL import Image
import sys
source, target = sys.argv[1], sys.argv[2]
with Image.open(source) as image:
    image.save(target, format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
`
const converted = spawnSync('python', ['-c', pillow, png, ico], { stdio: 'inherit', windowsHide: true })
if (converted.status !== 0) throw new Error(`ICO conversion failed with exit code ${converted.status ?? 'unknown'}`)

console.log(`desktop icon: ${png}`)
console.log(`desktop icon: ${ico}`)
