/** Display name on About / updates. Not `app.getName()`: unpackaged Electron
 * uses `dsh-editor-dev` only to isolate userData. */
export const DESKTOP_PRODUCT_NAME = 'DSH Editor'

/** Unpackaged `app.getVersion()` is Electron's own version (e.g. 37.2.6). */
export function readDesktopVersion(packageJson: string): string {
  const manifest = JSON.parse(packageJson) as { version?: unknown }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('desktop package.json is missing version')
  }
  return manifest.version.trim()
}
