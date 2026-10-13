// Theme switching helper — Phase 4.1 moved the toggle out of the topbar
// into the command palette (settings 外观 lands in 4.6). Scripts call this
// instead of clicking the old .theme-toggle button.
import { S } from './selectors.mjs'

// Opens the command palette and runs the theme command. Works in both
// locales because it matches the palette item's cmd id via the label
// regex covering zh and en.
export async function toggleTheme(page) {
  await page.locator(S.paletteTriggerButton).first().click()
  const input = page.locator(S.paletteInputField)
  await input.waitFor({ timeout: 10000 })
  await input.fill('主题')
  const item = page.locator(`${S.paletteItem}:has-text("切换"), ${S.paletteItem}:has-text("Switch")`)
  await item.first().waitFor({ timeout: 10000 })
  await item.first().click()
}
