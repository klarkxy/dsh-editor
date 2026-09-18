import type { ReactNode } from 'react';

type IconProps = { size?: number }

function svg(size: number, ...children: ReactNode[]) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false">
      {children}
    </svg>
  );
}

export function AppBrandMark({ size = 22 }: IconProps) {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}>
      <rect width="24" height="24" rx="6" fill="#1a7ff0"/>
      <path fill="#0a4ea8" fillOpacity="0.38" d="M0 17.6c3-1.1 5.6 0 8.1.55 2.5.55 5 .15 7.3-.6 2.5-.85 5.2-.7 8.6.25V24H0Z"/>
      <ellipse cx="9" cy="12.35" rx="5.55" ry="3.55" fill="#fff"/>
      <path d="M14.05 10.2C15.5 7.1 16.7 4.9 17.6 3.45" fill="none" stroke="#fff" strokeWidth="0.9" strokeLinecap="round"/>
      <ellipse cx="17.15" cy="3.2" rx="0.95" ry="0.42" transform="rotate(-50 17.15 3.2)" fill="#fff"/>
      <ellipse cx="18.15" cy="3.05" rx="0.95" ry="0.42" transform="rotate(40 18.15 3.05)" fill="#fff"/>
      <circle cx="6.35" cy="11.55" r=".4" fill="#163a66"/>
      <rect x="14.35" y="10.7" width="6.15" height="7.15" rx="1" fill="#fff"/>
      <path fill="#1a5aaa" d="M15.3 10.25h.75v.95h-.75zm1.75 0h.75v.95h-.75zm1.75 0h.75v.95h-.75z"/>
      <path fill="none" stroke="#b7c7d6" strokeWidth=".45" strokeLinecap="round" d="M15.55 13h3.55M15.55 14.55h3.55M15.55 16.1h2.35"/>
    </svg>
  )
}

export function FolderIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path
      d="M3.5 7.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.6 1.6a2 2 0 0 0 1.4.6h4.4a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
    <path d="M3.5 9.5h17" />,
  );
}

export function ChevronRightIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="m9 6 6 6-6 6" />,
  );
}

export function ChevronDownIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="m6 9 6 6 6-6" />,
  );
}

export function NewDocIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />,
    <path d="M13.5 3.5v4h4" />,
    <path d="M12 11v7M8.5 14.5h7" />,
  );
}

export function FileIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M7 3.5h6.5l4 4v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />,
    <path d="M13.5 3.5v4h4" />,
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M12 5v14M5 12h14" />,
  );
}

export function SearchIcon({ size = 16 }: IconProps) {
  return svg(size,
    <circle cx="11" cy="11" r="6.5" />,
    <path d="m20 20-3.6-3.6" />,
  );
}

export function SettingsIcon({ size = 16 }: IconProps) {
  return svg(size,
    <circle cx="12" cy="12" r="3" />,
    <path
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  );
}

export function FocusIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />,
  );
}

export function ThemePaperIcon({ size = 16 }: IconProps) {
  return svg(size,
    <circle cx="12" cy="12" r="3.4" />,
    <path
      d="M12 3.6v2.1M12 18.3v2.1M3.6 12h2.1M18.3 12h2.1M6.2 6.2l1.5 1.5M16.3 16.3l1.5 1.5M6.2 17.8l1.5-1.5M16.3 7.7l1.5-1.5" />,
  );
}

export function ThemeInkIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M5 14a7 7 0 0 1 12-4.9 6 6 0 0 1-1 11.4 7 7 0 0 1-11-6.5z" />,
    <path d="M9 19l-1 2.5M12.5 19.5l.5 2M16 18.7l1.2 1.8" />,
  );
}

export function ExportIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M12 4v10M8 8l4-4 4 4" />,
    <path d="M5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18.5v-2" />,
  );
}

export function HistoryIcon({ size = 16 }: IconProps) {
  return svg(size,
    <circle cx="12" cy="6.8" r="2.1" />,
    <circle cx="12" cy="17.2" r="2.1" />,
    <path d="M12 9v6" />,
  );
}

export function ArchiveIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M4 7.5h16v3H4z" />,
    <path d="M6 10.5v8h12v-8" />,
    <path d="M10 14h4" />,
  );
}

export function PinIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path d="M8.5 10.5 12 4.5l3.5 6v4.5l2.5 2.5H6l2.5-2.5z" />,
    <path d="M12 17.5V21" />,
  );
}

export function RegistryCommandIcon({ size = 16 }: IconProps) {
  return svg(size,
    <rect x="4.5" y="4.5" width="15" height="15" rx="2" />,
    <path d="M12 8.5v7" />,
    <path d="M8.5 12h7" />,
  );
}

export function StopIcon({ size = 16 }: IconProps) {
  return svg(size,
    <rect
      x="7"
      y="7"
      width="10"
      height="10"
      rx="1.2"
      fill="currentColor"
      stroke="none" />,
  );
}
