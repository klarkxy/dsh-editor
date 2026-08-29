import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'apps', 'desktop', 'build', 'icon.svg')
const png = resolve(root, 'apps', 'desktop', 'build', 'icon.png')
const ico = resolve(root, 'apps', 'desktop', 'build', 'icon.ico')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
  const svg = await readFile(source, 'utf8')
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`)
  await page.locator('svg').screenshot({ path: png, omitBackground: true })
} finally {
  await browser.close()
}

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
