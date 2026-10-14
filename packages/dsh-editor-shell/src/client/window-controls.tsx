import { useEffect, useState, type ReactNode } from 'react';
import { Flex, IconButton } from '../ui/index.ts'
import { t } from '../i18n/index.ts'

import { windowBridge } from '../model/window-controls.ts'


/** 窗口控制用与 icons.tsx 一致的描边 SVG，替代 Unicode 字形（CJK 字体下 ❐/▢ 有缺字风险）。 */
function WindowGlyph(props: { children?: ReactNode }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false">
      {props.children}
    </svg>
  )
}

export function WindowControls() {
  const bridge = windowBridge()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => bridge?.onMaximizedChange?.(setMaximized), [bridge])
  if (!bridge) return null
  return (
    <Flex className="window-controls" align="center" flexShrink="0">
      <IconButton
        type="button"
        variant="ghost"
        size="md"
        label={t('window.minimize')}
        onClick={() => bridge.minimize()}>
        <WindowGlyph>
          <path d="M2 6h8" />
        </WindowGlyph>
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        size="md"
        label={maximized ? t('window.restore') : t('window.maximize')}
        onClick={() => bridge.toggleMaximize()}>
        {maximized
          ? <WindowGlyph>
            <path d="M2 5h5v5H2z" />
            <path d="M5 5V2h5v5H7" />
          </WindowGlyph>
          : <WindowGlyph>
            <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
          </WindowGlyph>}
      </IconButton>
      <IconButton
        type="button"
        className="window-close"
        variant="ghost"
        size="md"
        label={t('window.close')}
        onClick={() => bridge.close()}>
        <WindowGlyph>
          <path d="M3 3l6 6M9 3l-6 6" />
        </WindowGlyph>
      </IconButton>
    </Flex>
  );
}
