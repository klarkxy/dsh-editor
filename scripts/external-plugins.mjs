/** Resolve approved npm plugins at build/dev time. This module never installs or downloads. */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const EXTERNAL_PLUGIN_MANIFEST = 'apps/desktop/resources/external-plugins.json';
const packageName = /^@klarkxy\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
export function externalPluginPins(root) {
  const file = join(root, EXTERNAL_PLUGIN_MANIFEST);
  if (!existsSync(file)) return {};
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.schema !== 1 || !manifest.packages || typeof manifest.packages !== 'object' || Array.isArray(manifest.packages)) throw new Error('Invalid external plugin manifest');
  const owner = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(manifest.packages)) {
    if (!packageName.test(name) || typeof version !== 'string' || !exactVersion.test(version)) throw new Error(`External plugin must use an approved name and exact version: ${name}@${version}`);
    if (owner.devDependencies?.[name] !== version && owner.dependencies?.[name] !== version) throw new Error(`External plugin pin disagrees with root package.json: ${name}`);
    if (existsSync(join(root, 'packages', name.split('/')[1], 'package.json'))) throw new Error(`External plugin still has a local source owner: ${name}`);
  }
  return manifest.packages;
}
export function externalPluginDirectories(root) {
  const pins = externalPluginPins(root);
  if (!Object.keys(pins).length) return [];
  const require = createRequire(join(root, 'package.json'));
  return Object.entries(pins).map(([name, version]) => {
    let file;
    try { file = require.resolve(`${name}/package.json`); }
    catch { throw new Error(`External plugin is not installed: ${name}@${version}; run pnpm install --frozen-lockfile before building`); }
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.name !== name || pkg.version !== version) throw new Error(`External plugin identity/version mismatch: expected ${name}@${version}, found ${pkg.name}@${pkg.version}`);
    if (!pkg.dsh?.bundle?.patch || pkg.dshEditor?.visibility !== 'public') throw new Error(`External package is not a public Editor-compatible bundle: ${name}`);
    return { name, dir: dirname(file), external: true };
  });
}
