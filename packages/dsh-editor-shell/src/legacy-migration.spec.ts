import { describe, expect, it } from 'vitest'
import { shouldShowMigrationBanner } from './legacy-migration.ts'

describe('legacy migration banner visibility', () => {
  it('shows only for legacy sessions that have not been dismissed', () => {
    expect(shouldShowMigrationBanner({ legacy: true, dismissed: false })).toBe(true)
    expect(shouldShowMigrationBanner({ legacy: true, dismissed: true })).toBe(false)
    expect(shouldShowMigrationBanner({ legacy: false, dismissed: false })).toBe(false)
    expect(shouldShowMigrationBanner({ legacy: false, dismissed: true })).toBe(false)
  })
})
