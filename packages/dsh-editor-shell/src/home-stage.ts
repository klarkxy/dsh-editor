import { t } from './i18n/index.ts'

/** Copy the home stage interpolates. Keep in sync with HomeScreen. */
export function homeStageCopy(): { intro: string; openWork: string; newWork: string } {
  return {
    intro: t('home.intro'),
    openWork: t('home.openWork'),
    newWork: t('home.new'),
  }
}
