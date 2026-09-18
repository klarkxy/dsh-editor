import type { ReactNode } from 'react'
import mascotUrl from './assets/mascot.webp'
import { t } from '../i18n/index.ts'

type MascotSize = 'home' | 'about'

const SIZE_PX: Record<MascotSize, { width: number; height: number }> = {
  home: { width: 400, height: 534 },
  about: { width: 560, height: 748 },
}

/** Brand character for the lobby and About page. Not used on the writing surface. */
export function AppMascot(props: {
  size?: MascotSize
  className?: string
  decorative?: boolean
}): ReactNode {
  const size = props.size ?? 'home'
  const box = SIZE_PX[size]
  return (
    <img
      className={`app-mascot app-mascot-${size}${props.className ? ` ${props.className}` : ''}`}
      src={mascotUrl}
      alt={props.decorative ? '' : t('mascot.alt')}
      width={box.width}
      height={box.height}
      decoding="async"
      draggable={false}
      aria-hidden={props.decorative ? true : undefined} />
  )
}
