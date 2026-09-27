import { test } from 'vitest'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { packageCopyFilter } from './package-copy.mjs'

test('keeps plugin artifacts under npm and pnpm parent directories', () => {
  for (const parent of ['packages', 'node_modules/@klarkxy', 'node_modules/.pnpm/plugin@1/node_modules/@klarkxy']) {
    const root = join(tmpdir(), 'src', parent, 'dsh-plugin')
    const filter = packageCopyFilter(root)
    for (const path of ['', 'package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'resources/icon.svg']) {
      assert.equal(filter(join(root, path)), true, path)
    }
    for (const path of ['node_modules', 'node_modules/a/index.js', 'src', 'src/index.ts', 'test', 'test/index.ts', 'tsconfig.json', 'tsdown.config.ts']) {
      assert.equal(filter(join(root, path)), false, path)
    }
    assert.equal(filter(join(root, '..', 'other', 'lib/index.js')), false)
    assert.equal(filter(join(root, 'lib/index.js.map')), true)
    assert.equal(packageCopyFilter(root, { omitMaps: true })(join(root, 'lib/index.js.map')), false)
  }
})

test('copies the complete installed plugin while excluding source and nested dependencies', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'editor-package-copy-'))
  try {
    const source = join(temp, 'node_modules/.pnpm/plugin@1/node_modules/@klarkxy/dsh-plugin')
    const destination = join(temp, 'profile/node_modules/@klarkxy/dsh-plugin')
    const files = {
      'package.json': '{"name":"@klarkxy/dsh-plugin"}',
      'lib/index.js': 'export const ready = true',
      'cordis.patch.yml': '[]',
      'resources/icon.svg': '<svg/>',
      'src/index.ts': 'source',
      'test/case.ts': 'test',
      'node_modules/dependency/index.js': 'nested dependency',
    }
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split('/'); parts.pop()
      await mkdir(join(source, ...parts), { recursive: true })
      await writeFile(join(source, path), content)
    }
    await cp(source, destination, { recursive: true, dereference: true, filter: packageCopyFilter(source) })
    for (const path of ['package.json', 'lib/index.js', 'cordis.patch.yml', 'resources/icon.svg']) {
      assert.equal(await readFile(join(destination, path), 'utf8'), files[path])
    }
    for (const path of ['src', 'test', 'node_modules']) assert.equal(existsSync(join(destination, path)), false)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
