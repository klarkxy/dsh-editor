import { copyFile, readFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const sourceSvg = resolve(root, 'apps', 'desktop', 'build', 'icon.svg')
const sourcePng = resolve(root, 'apps', 'desktop', 'build', 'icon-source.png')
const png = resolve(root, 'apps', 'desktop', 'build', 'icon.png')
const ico = resolve(root, 'apps', 'desktop', 'build', 'icon.ico')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// The titled SVG stays the documented wrapper. When the raster artwork is
// present, copy it through so the desktop/Windows icons stay pixel-identical
// to the source mark instead of a Playwright screenshot of an <image> href.
if (await exists(sourcePng)) {
  await copyFile(sourcePng, png)
} else {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
    const svg = await readFile(sourceSvg, 'utf8')
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`)
    await page.locator('svg').screenshot({ path: png, omitBackground: true })
  } finally {
    await browser.close()
  }
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
