import { describe, expect, it } from 'vitest'
import { assertSafeTarListing, listTarEntries } from './install.ts'

describe('install tarball inspection', () => {
  it('rejects empty, oversized or escaping archives before extract', () => {
    expect(() => assertSafeTarListing([])).toThrow(/空/)
    expect(() => assertSafeTarListing(['../evil'])).toThrow(/不安全/)
    expect(() => assertSafeTarListing(['/etc/passwd'])).toThrow(/不安全/)
    expect(() => assertSafeTarListing(listTarEntries('owner-repo/package.json\nowner-repo/lib/index.js\n'))).not.toThrow()
  })
})
