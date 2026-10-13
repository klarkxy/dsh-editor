/*
 * 「原稿」图标集：移植 client/icons.tsx 的路径，统一 1.5px 线宽与
 * icon-sm/icon-md/icon-lg 三档 token 尺寸（design-system-spec §5）。
 */
import type { ReactNode } from 'react'

export type IconSize = 'sm' | 'md' | 'lg'
const SIZE_VAR: Record<IconSize, string> = {
  sm: 'var(--dsh-ui-icon-sm)',
  md: 'var(--dsh-ui-icon-md)',
  lg: 'var(--dsh-ui-icon-lg)',
}

export type IconProps = { size?: IconSize; className?: string }

function svg(size: IconSize | undefined, className: string | undefined, children: ReactNode) {
  const dim = SIZE_VAR[size ?? 'md']
  return (
    <svg
      viewBox="0 0 24 24"
      width={dim}
      height={dim}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false">
      {children}
    </svg>
  )
}

const make = (paths: ReactNode) => function Icon({ size, className }: IconProps) {
  return svg(size, className, paths)
}

export const FolderIcon = make(<>
  <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.6 1.6a2 2 0 0 0 1.4.6h4.4a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  <path d="M3.5 9.5h17" />
</>)
export const CrossIcon = make(<path d="m6 6 12 12M18 6 6 18" />)
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />)
export const DotsIcon = make(<path d="M5 12h.01M12 12h.01M19 12h.01" />)
export const PanelLeftIcon = make(<>
  <rect x="3.5" y="5" width="17" height="14" rx="2" />
  <path d="M9.5 5v14" />
</>)
export const PanelRightIcon = make(<>
  <rect x="3.5" y="5" width="17" height="14" rx="2" />
  <path d="M14.5 5v14" />
</>)
export const ChevronRightIcon = make(<path d="m9 6 6 6-6 6" />)
export const ChevronLeftIcon = make(<path d="m15 6-6 6 6 6" />)
export const ChevronDownIcon = make(<path d="m6 9 6 6 6-6" />)
export const NewDocIcon = make(<>
  <path d="M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
  <path d="M13.5 3.5v4h4" />
  <path d="M12 11v7M8.5 14.5h7" />
</>)
export const FileIcon = make(<>
  <path d="M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
  <path d="M13.5 3.5v4h4" />
</>)
export const FileTextIcon = make(<>
  <path d="M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
  <path d="M13.5 3.5v4h4" />
  <path d="M9 12h6M9 15.5h6" />
</>)
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />)
export const SearchIcon = make(<>
  <circle cx="11" cy="11" r="6.5" />
  <path d="m20 20-3.6-3.6" />
</>)
export const SettingsIcon = make(<>
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
</>)
export const FocusIcon = make(<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />)
export const ExportIcon = make(<>
  <path d="M12 4v10M8 8l4-4 4 4" />
  <path d="M5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18.5v-2" />
</>)
export const HistoryIcon = make(<>
  <circle cx="12" cy="6.8" r="2.1" />
  <circle cx="12" cy="17.2" r="2.1" />
  <path d="M12 9v6" />
</>)
export const PinIcon = make(<>
  <path d="M8.5 10.5 12 4.5l3.5 6v4.5l2.5 2.5H6l2.5-2.5z" />
  <path d="M12 17.5V21" />
</>)
export const StopIcon = make(<rect x="7" y="7" width="10" height="10" rx="1.2" fill="currentColor" stroke="none" />)
export const InfoIcon = make(<>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 11v5" />
  <path d="M12 7.5h.01" />
</>)
export const WarningIcon = make(<>
  <path d="M12 4 2.8 19.5h18.4L12 4z" />
  <path d="M12 9.5v5" />
  <path d="M12 17h.01" />
</>)
export const MicIcon = make(<>
  <rect x="9" y="3.5" width="6" height="11" rx="3" />
  <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
  <path d="M12 17.5V21" />
</>)
export const SendIcon = make(<path d="M4.5 12 19 4.5l-3.2 7.5 3.2 7.5L4.5 12zm0 0H15" />)
export const ChatIcon = make(<>
  <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 4V5.5Z" />
</>)
export const ImageIcon = make(<>
  <rect x="4" y="5" width="16" height="14" rx="2" />
  <circle cx="9" cy="10" r="1.6" />
  <path d="m4.5 17 4.5-4.5 3 3 3.5-3.5 4 4" />
</>)
