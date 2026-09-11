import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = process.argv[2]
if (!pkg) {
  console.error('usage: wrap-client.mjs <package-name>')
  process.exit(1)
}
const inner = path.resolve('lib/client.inner.cjs')
const alt = path.resolve('lib/client.inner.js')
const srcPath = fs.existsSync(inner) ? inner : alt
if (!fs.existsSync(srcPath)) {
  console.error(`missing ${srcPath}`)
  process.exit(1)
}
const body = fs.readFileSync(srcPath, 'utf8')
const shim = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'client-node-shims.cjs'), 'utf8')
const wrapped = `${shim}
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg)},
  factory: (dshRequire) => {
    var __nodeShims;
    var process = globalThis.process || { env: {}, nextTick: function (fn) { var args = [].slice.call(arguments, 1); queueMicrotask(function () { fn.apply(null, args); }); } };
    var require = function (id) {
      if (id === 'buffer' || id === 'stream' || id === 'util' || id === 'events') {
        if (!__nodeShims) __nodeShims = __createDshNodeShims();
        return __nodeShims[id];
      }
      return dshRequire(id);
    };
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
fs.writeFileSync(path.resolve('lib/client.js'), wrapped)
console.log('wrapped', pkg, '-> lib/client.js')
