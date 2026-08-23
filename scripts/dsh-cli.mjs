import fs from 'node:fs'
import path from 'node:path'

export const EXPECTED_DSH_VERSION = '0.1.1-rc.1'

function candidatePackageRoots() {
  const configuredCli = process.env.DSH_CLI_PATH?.trim()
  if (configuredCli) {
    const cli = path.resolve(configuredCli)
    return [{ packageRoot: path.dirname(path.dirname(cli)), source: 'DSH_CLI_PATH' }]
  }

  const candidates = []
  for (const entry of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const binDir = path.resolve(entry.replace(/^"|"$/g, ''))
    const shims = process.platform === 'win32' ? ['dsh.exe', 'dsh.cmd', 'dsh.ps1', 'dsh'] : ['dsh']
    if (shims.some((name) => fs.existsSync(path.join(binDir, name)))) {
      candidates.push({ packageRoot: path.join(binDir, 'node_modules', '@deepseek-ai', 'dsh'), source: 'PATH' })
    }
  }

  candidates.push({ packageRoot: path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh'), source: 'workspace' })
  return [...new Map(candidates.map((item) => [path.resolve(item.packageRoot), {
    packageRoot: path.resolve(item.packageRoot),
    source: item.source,
  }])).values()]
}

export function resolveDshInstallation(expectedVersion = EXPECTED_DSH_VERSION) {
  for (const { packageRoot, source } of candidatePackageRoots()) {
    const manifestPath = path.join(packageRoot, 'package.json')
    const cliPath = path.join(packageRoot, 'lib', 'bin.js')
    if (!fs.existsSync(manifestPath) || !fs.existsSync(cliPath)) continue
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== '@deepseek-ai/dsh') continue
    if (manifest.version !== expectedVersion) {
      throw new Error(`DSH version mismatch: expected ${expectedVersion}, found ${manifest.version} at ${packageRoot}`)
    }
    return { cliPath, packageRoot, version: manifest.version, source }
  }

  if (process.env.DSH_CLI_PATH?.trim()) {
    throw new Error(`DSH_CLI_PATH does not point to an installed @deepseek-ai/dsh ${expectedVersion} CLI`)
  }
  throw new Error(
    `DSH ${expectedVersion} was not found from PATH. Set DSH_CLI_PATH to the absolute @deepseek-ai/dsh/lib/bin.js path.`,
  )
}
