import fs from 'node:fs'
import path from 'node:path'

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
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
fs.writeFileSync(path.resolve('lib/client.js'), wrapped)
console.log('wrapped', pkg, '-> lib/client.js')
