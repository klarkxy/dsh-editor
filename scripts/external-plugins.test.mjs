import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EXTERNAL_PLUGIN_MANIFEST, externalPluginPins, externalPluginDirectories } from './external-plugins.mjs';
const name = '@klarkxy/dsh-example';
function put(root, file, value) { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function fixture(t, pins = { [name]: '1.2.3' }) {
  const root = mkdtempSync(join(tmpdir(), 'editor-external-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'package.json', { private: true, devDependencies: pins });
  put(root, EXTERNAL_PLUGIN_MANIFEST, { schema: 1, packages: pins });
  return root;
}
function install(root, overrides = {}) { put(root, `node_modules/${name}/package.json`, { name, version: '1.2.3', exports: { './package.json': './package.json' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, dshEditor: { visibility: 'public' }, ...overrides }); }
test('resolves only explicitly pinned installed bundles', t => {
  const root = fixture(t); install(root);
  assert.deepEqual(externalPluginPins(root), { [name]: '1.2.3' });
  assert.deepEqual(externalPluginDirectories(root), [{ name, dir: join(root, `node_modules/${name}`), external: true }]);
});
test('missing installation fails with build-time repair guidance', t => { assert.throws(() => externalPluginDirectories(fixture(t)), /not installed/); });
test('mismatched installed versions and identities fail closed', t => {
  const root = fixture(t); install(root, { version: '1.2.4' }); assert.throws(() => externalPluginDirectories(root), /mismatch/);
  install(root, { name: '@klarkxy/dsh-other' }); assert.throws(() => externalPluginDirectories(root), /mismatch/);
});
test('ranges, latest, URLs and unapproved package names cannot enter the composition', t => {
  for (const value of ['latest', '^1.2.3', '1.2', 'file:../plugin', 'https://example.com/p.tgz']) assert.throws(() => externalPluginPins(fixture(t, { [name]: value })), /exact version/);
  assert.throws(() => externalPluginPins(fixture(t, { '../../unsafe': '1.2.3' })), /approved name/);
});
test('root dependencies must match the product pin', t => {
  const root = fixture(t); put(root, 'package.json', { devDependencies: { [name]: '1.2.4' } }); assert.throws(() => externalPluginPins(root), /disagrees/);
});
test('duplicate local source ownership is rejected', t => { const root = fixture(t); put(root, 'packages/dsh-example/package.json', { name }); assert.throws(() => externalPluginPins(root), /local source owner/); });
test('private/non-bundle packages are not silently accepted', t => { const root = fixture(t); install(root, { dshEditor: { visibility: 'desktop' } }); assert.throws(() => externalPluginDirectories(root), /public Editor-compatible bundle/); });
test('old isolated manifest fixtures without external inputs still work', t => { const root = fixture(t); rmSync(join(root, EXTERNAL_PLUGIN_MANIFEST)); assert.deepEqual(externalPluginDirectories(root), []); });
test('malformed external manifests are rejected', t => { const root = fixture(t); put(root, EXTERNAL_PLUGIN_MANIFEST, { schema: 1, packages: [] }); assert.throws(() => externalPluginPins(root), /Invalid external/); });
