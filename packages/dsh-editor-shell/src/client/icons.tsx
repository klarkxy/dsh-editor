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

export function FolderIcon({ size = 16 }: IconProps) {
  return svg(size,
    <path
      d="M3.5 7.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.6 1.6a2 2 0 0 0 1.4.6h4.4a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
    <path d="M3.5 9.5h17" />,
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
    <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />,
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
