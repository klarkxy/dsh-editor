import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_PRODUCT_NAME, readDesktopVersion } from '../src/app-identity.ts'

describe('desktop identity', () => {
  it('reads the desktop package version instead of Electron\'s', async () => {
    const source = await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8')
    expect(readDesktopVersion(source)).toBe(JSON.parse(source).version)
    expect(readDesktopVersion(source)).not.toBe('37.2.6')
    expect(DESKTOP_PRODUCT_NAME).toBe('DSH Editor')
  })

  it('rejects a manifest without a version', () => {
    expect(() => readDesktopVersion('{"name":"@dsh-editor/desktop"}')).toThrow(/missing version/)
  })
})
