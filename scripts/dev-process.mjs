/** Shared matching for leftover `pnpm run dev` processes and first-compile logs. */

export function normalizeCommand(value) {
  return String(value ?? '').replaceAll('/', '\\').toLowerCase()
}

export function isLeftoverDevCommand(commandLine, root) {
  const command = normalizeCommand(commandLine)
  const rootKey = normalizeCommand(root)
  if (!command || !rootKey || !command.includes(rootKey)) return false
  if (command.includes('tsdown') && command.includes('--watch')) return true
  if (command.includes('apps\\desktop\\dist\\main.js')) return true
  if (command.includes('desktop-dsh-runtime\\lib\\bin.js')) return true
  return false
}

export function firstCompilePattern(packageName, wrapClient) {
  if (wrapClient) return new RegExp(`wrapped\\s+${escapeRegExp(packageName)}\\s+->`)
  return /Rebuilt in \d+ms/
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
