import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { builtinModules, createRequire, isBuiltin } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { packageCopyFilter } from './package-copy.mjs'

const requireFromHere = createRequire(import.meta.url)
const ts = requireFromHere('typescript')

const SKIP_CONDITIONS = new Set(['types', 'browser', 'module'])
const JS_KIND = new Set(['.js', '.mjs', '.cjs'])

/**
 * Copy a compiled app package and write a deployment manifest whose
 * `dependencies` are only actual Node runtime edges. Selected app artifacts
 * become `file:` siblings; materialized SDK packages become `link:` paths to
 * caller-supplied stable directories. Does not copy `node_modules`, modify the
 * source tree, or create a registry/store.
 *
 * @param {{ source: string, destination: string, artifacts?: Record<string, string>, runtimes?: Record<string, string> }} options
 *   Absolute source package, destination package, and complete name→absolute
 *   directory maps for selected app artifacts and runtime-link packages.
 */
export async function copyNativePackageArtifact(options) {
  const source = resolve(requiredPath(options?.source, 'source'))
  const destination = resolve(requiredPath(options?.destination, 'destination'))
  const artifacts = absMap(options?.artifacts, 'artifacts')
  const runtimes = absMap(options?.runtimes, 'runtimes')
  await mkdir(destination, { recursive: true })
  await cp(source, destination, { recursive: true, dereference: true, filter: packageCopyFilter(source, { omitMaps: true }) })
  const projected = await projectNativePackageManifest({ source, destination, artifacts, runtimes })
  await writeFile(join(destination, 'package.json'), `${JSON.stringify(projected, null, 2)}\n`)
  return projected
}

/**
 * Project a deployment `package.json` from compiled Node entries without
 * writing files. Caller supplies the same absolute maps as the copy helper.
 */
export async function projectNativePackageManifest({ source, destination, artifacts = {}, runtimes = {} }) {
  const sourceRoot = resolve(requiredPath(source, 'source'))
  const destRoot = resolve(requiredPath(destination, 'destination'))
  const manifest = await readJson(join(sourceRoot, 'package.json'))
  const names = new Set(await collectRuntimePackageNames(sourceRoot, manifest))
  for (const name of requiredPeerNames(manifest)) names.add(name)
  const dependencies = {}
  for (const name of [...names].sort()) {
    dependencies[name] = dependencySpec(name, destRoot, artifacts, runtimes)
  }
  const projected = { ...manifest, dependencies }
  delete projected.devDependencies
  delete projected.optionalDependencies
  return projected
}

function requiredPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label} directory`)
  return value
}

function absMap(value, label) {
  const out = {}
  if (value == null) return out
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a name→absolute-directory map`)
  for (const [name, dir] of Object.entries(value)) {
    if (typeof dir !== 'string' || !isAbsolute(dir)) throw new Error(`${label}[${name}] must be an absolute directory`)
    out[name] = resolve(dir)
  }
  return out
}

async function collectRuntimePackageNames(sourceRoot, manifest) {
  const names = new Set()
  const pending = [...nodeEntryFiles(manifest, sourceRoot)]
  const seen = new Set()
  const req = createRequire(join(sourceRoot, 'package.json'))
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const specifiers = literalModuleSpecifiers(file, await readFile(file, 'utf8'))
    for (const specifier of specifiers) {
      if (isRelative(specifier)) {
        const next = resolveRelativeJs(file, specifier)
        if (next) pending.push(next)
        continue
      }
      const name = barePackageName(specifier)
      if (!name) continue
      assertResolvable(req, name, specifier, sourceRoot)
      names.add(name)
    }
  }
  return names
}

function nodeEntryFiles(manifest, sourceRoot) {
  const targets = []
  if (manifest.exports !== undefined) collectExport(manifest.exports, targets, '.')
  else if (typeof manifest.main === 'string') targets.push(manifest.main)
  else throw new Error(`Unsupported Node export: ${sourceRoot} has no Node entry`)
  const files = []
  for (const target of targets) {
    if (!isJavaScriptTarget(target)) continue
    const file = resolve(sourceRoot, target)
    if (!existsSync(file)) throw new Error(`Missing artifact: Node entry ${target} in ${sourceRoot}`)
    files.push(file)
  }
  if (!files.length) throw new Error(`Unsupported Node export: ${sourceRoot} has no Node JavaScript entry`)
  return files
}

function collectExport(value, targets, subpath) {
  if (typeof value === 'string') {
    if (value.includes('*') || String(subpath).includes('*')) {
      if (isJavaScriptWildcardTarget(value) || isJavaScriptWildcardTarget(subpath)) {
        throw new Error(`Unsupported Node export: ${subpath}`)
      }
      return
    }
    if (isJavaScriptTarget(value)) targets.push(value)
    return
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Unsupported Node export: ${subpath}`)
  }
  const keys = Object.keys(value)
  if (keys.some(key => key === '.' || key.startsWith('./'))) {
    for (const [key, nested] of Object.entries(value)) {
      if (key === './package.json' || isClientExport(key)) continue
      collectExport(nested, targets, key)
    }
    return
  }
  if ('node' in value) {
    collectExport(value.node, targets, subpath)
    return
  }
  let matched = false
  if ('import' in value) {
    collectExport(value.import, targets, subpath)
    matched = true
  }
  if ('require' in value) {
    collectExport(value.require, targets, subpath)
    matched = true
  }
  if (!matched && 'default' in value) {
    collectExport(value.default, targets, subpath)
    matched = true
  }
  if (matched) return
  if (keys.every(key => SKIP_CONDITIONS.has(key))) return
  throw new Error(`Unsupported Node export: ${subpath}`)
}

function isJavaScriptTarget(target) {
  if (typeof target !== 'string' || !target.trim() || target.includes('*')) return false
  return isJavaScriptPath(target)
}

function isJavaScriptWildcardTarget(target) {
  return typeof target === 'string' && target.includes('*') && isJavaScriptPath(target)
}

function isJavaScriptPath(target) {
  const path = target.split(/[?#]/)[0].replaceAll('\\', '/')
  if (/\.d\.[cm]?ts$/i.test(path)) return false
  return JS_KIND.has(ext(path))
}

function isClientExport(key) {
  return key === './client' || key.startsWith('./client/')
}

function literalModuleSpecifiers(file, text) {
  const kind = file.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.JS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const specifiers = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword
      const required = ts.isIdentifier(callee) && callee.text === 'require'
      if (dynamic || required) specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function resolveRelativeJs(fromFile, specifier) {
  const candidate = resolve(dirname(fromFile), specifier)
  if (existsSync(candidate) && JS_KIND.has(ext(candidate))) return candidate
  if (existsSync(candidate)) return undefined
  throw new Error(`Missing artifact: relative module ${specifier} from ${fromFile}`)
}

function ext(file) {
  const base = file.replaceAll('\\', '/')
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot)
}

function barePackageName(specifier) {
  if (specifier.startsWith('node:') || isBuiltin(specifier) || builtinModules.includes(specifier)) return undefined
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    if (!name) throw new Error(`Missing dependency source: invalid specifier ${specifier}`)
    return `${scope}/${name}`
  }
  const name = specifier.split('/')[0]
  return name || undefined
}

function assertResolvable(req, name, specifier, sourceRoot) {
  for (const id of [specifier, name, `${name}/package.json`]) {
    try {
      req.resolve(id)
      return
    } catch { /* try next */ }
  }
  throw new Error(`Missing dependency source: cannot resolve ${name} from ${sourceRoot}`)
}

function requiredPeerNames(manifest) {
  const peers = manifest.peerDependencies && typeof manifest.peerDependencies === 'object' ? manifest.peerDependencies : {}
  const meta = manifest.peerDependenciesMeta && typeof manifest.peerDependenciesMeta === 'object' ? manifest.peerDependenciesMeta : {}
  return Object.keys(peers).filter(name => !meta[name]?.optional)
}

function dependencySpec(name, destination, artifacts, runtimes) {
  if (artifacts[name]) return protocolSpec('file', destination, artifacts[name])
  if (runtimes[name]) return protocolSpec('link', destination, runtimes[name])
  throw new Error(`Missing dependency source: ${name} is not in artifact or runtime maps`)
}

function protocolSpec(protocol, fromDir, targetDir) {
  let rel = relative(fromDir, targetDir).replaceAll('\\', '/')
  if (!rel || rel === '.') rel = '.'
  else if (!rel.startsWith('.') && !isAbsolute(rel)) rel = `./${rel}`
  return `${protocol}:${rel}`
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`Missing artifact: ${path}`)
    throw error
  }
}
