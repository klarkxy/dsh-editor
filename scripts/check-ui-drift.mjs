/** Incremental source guard, not a CSS parser or a visual acceptance test. */
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const owners = new Set([
  'packages/dsh-editor-shell/src/design-system/tokens.ts',
  'packages/dsh-editor-shell/src/design-system/styles.ts',
  'packages/dsh-editor-shell/src/design-system/compat.ts',
  'packages/dsh-editor-shell/src/design-system/dsw-vars.ts',
])

export function isUiSource(path) {
  if (!/^(packages|apps)\//.test(path) || owners.has(path)) return false
  if (/(^|\/)(node_modules|lib|dist|dist-web|assets|resources|__tests__|tests?|fixtures)(\/|$)/.test(path)) return false
  if (/\.(spec|test)\.[^/]+$|\.d\.ts$/.test(path)) return false
  return /\.(css|scss|less|tsx|jsx)$/.test(path)
    || (/\.[cm]?[jt]s$/.test(path) && /\/client(?:\/|\.)|\/(?:styles?|theme[^/]*)\.[^/]+$|\/design-system\//.test(path))
}

const rules = [
  ['literal-color', /(?<![\w/#])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|lch|lab)\(\s*[-+.\d][^)]*\)/gi],
  ['decorative-effect', /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(|\bbackdrop(?:-filter|Filter)\s*:\s*["']?(?!none\b)[\w(.-]+/gi],
  ['cascade-override', /!important\b/gi],
  ['literal-scale', /\b(?:border-radius|borderRadius|font-size|fontSize|font-weight|fontWeight|z-index|zIndex)\s*:\s*["']?(-?\d+(?:\.\d+)?(?:px|rem|em|%)?)(?=["'\s;,}])/g],
  ['literal-shadow', /\b(?:box-shadow|boxShadow|text-shadow|textShadow)\s*:\s*["']?(?:inset\s+)?-?\d[^;\n}"']*/g],
  // 新文件不得再 import @radix-ui/themes；既有文件按增量基线只减不增。
  ['radix-themes-import', /['"]@radix-ui\/themes(?:\/[^'"]*)?['"]/g],
  // style={{}} 不写外观属性（design-system-spec §5）；布局属性不受影响。
  ['inline-appearance', /style=\{\{[^{}]*?\b(?:color|background|border|borderRadius|boxShadow|fontSize|fontWeight|fontFamily|zIndex)\s*:[^{}]*?\}\}/g],
]

export function findings(source) {
  // Preserve newlines for diagnostics. This intentionally does not parse every
  // JS string/regex edge; possible false positives require inspection, not skips.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/[^\n]*/gm, s => s.replace(/[^\n]/g, ' '))
  const result = []
  for (const [rule, pattern] of rules) {
    for (const match of text.matchAll(pattern)) {
      if (rule === 'literal-scale' && /^0(?:px|rem|em|%)?$/.test(match[1])) continue
      /* literal-shadow 的形状由几何值界定；颜色变量改名（--accent-a4 →
         --dsh-ui-accent-soft 这类 token 迁移）不算新增违规。 */
      const value = match[0].replace(/\s+/g, ' ').toLowerCase()
      const normalized = rule === 'literal-shadow' ? value.replace(/var\(--[\w-]+\)/g, 'var(--x)') : value
      result.push({ rule, value: normalized, line: text.slice(0, match.index).split('\n').length })
    }
  }
  return result
}

export function regressions(before, after) {
  return subtract(findings(after), findings(before))
}

/* first \ second（按 rule:value 做多集差）：返回 first 中未被 second 覆盖的发现。 */
function subtract(first, second) {
  const remaining = new Map()
  for (const f of second) {
    const key = `${f.rule}:${f.value}`
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  return first.filter(f => {
    const key = `${f.rule}:${f.value}`, count = remaining.get(key) ?? 0
    if (!count) return true
    remaining.set(key, count - 1)
    return false
  })
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
function revision(cwd, ref) {
  try { return git(cwd, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim() }
  catch { throw new Error(`Cannot resolve revision ${JSON.stringify(ref)}. Fetch the base; checks were NOT skipped.`) }
}
function contents(cwd, ref, path) {
  if (!ref) {
    const absolute = resolve(cwd, path)
    if (!lstatSync(absolute).isFile()) throw new Error(`UI source is not a regular file: ${path}`)
    return readFileSync(absolute, 'utf8')
  }
  // Distinguish a genuinely absent file from a failed Git read.
  if (!git(cwd, 'ls-tree', '-z', ref, '--', path)) return ''
  return git(cwd, 'show', `${ref}:${path}`)
}

export function checkWorkingTree({ cwd = process.cwd(), base, head } = {}) {
  if (!base) throw new Error('Supply --base <task-start SHA or target branch>; no implicit baseline reset.')
  const root = git(cwd, 'rev-parse', '--show-toplevel').trim()
  const target = revision(root, head ?? 'HEAD')
  const start = git(root, 'merge-base', revision(root, base), target).trim()
  const changed = git(root, 'diff', '--name-only', '--no-renames', '--diff-filter=ACMRT', '-z', start, ...(head ? [target] : []), '--')
  const untracked = head ? '' : git(root, 'ls-files', '--others', '--exclude-standard', '-z')
  const allChanged = `${changed}${untracked}`.split('\0').filter(Boolean)
  const paths = [...new Set(allChanged)].filter(isUiSource)
  /* 文件级预算对规则迁移不公平：声明原样搬到其他文件（如 6a-3 的 sheet 折叠）
     时接收方没有存量预算。把本次 diff 里所有被移除的发现汇成共享池 —— 包括被删
     文件、被修改文件里删掉的行，以及 owners 源（design-system 单文件折叠前规则
     所在处，本身不参与扫描）。新增违规不在池中，仍会被拦下。 */
  const tracked = path => isUiSource(path) || owners.has(path)
  const deleted = git(root, 'diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', start, ...(head ? [target] : []), '--')
  const movedBudget = new Map()
  const pool = list => {
    for (const f of list) {
      const key = `${f.rule}:${f.value}`
      movedBudget.set(key, (movedBudget.get(key) ?? 0) + 1)
    }
  }
  for (const path of deleted.split('\0').filter(Boolean).filter(tracked)) {
    pool(findings(contents(root, start, path)))
  }
  for (const path of new Set(allChanged.filter(tracked))) {
    const beforeText = contents(root, start, path)
    if (!beforeText) continue
    pool(subtract(findings(beforeText), findings(contents(root, head ? target : undefined, path))))
  }
  const consume = f => {
    const key = `${f.rule}:${f.value}`, count = movedBudget.get(key) ?? 0
    if (!count) return true
    movedBudget.set(key, count - 1)
    return false
  }
  const issues = paths.flatMap(path => {
    const before = contents(root, start, path)
    const after = contents(root, head ? target : undefined, path)
    const added = before ? regressions(before, after) : findings(after)
    return added.filter(consume).map(f => ({ path, ...f }))
  })
  return { base: start, files: paths.length, issues }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i += 2) {
      if (!['--base', '--head'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error('Usage: node scripts/check-ui-drift.mjs --base <ref> [--head <ref>]')
      }
      options[args[i].slice(2)] = args[i + 1]
    }
    const result = checkWorkingTree(options)
    for (const f of result.issues) console.error(`${f.path}:${f.line}: ${f.rule}: ${f.value}`)
    if (result.issues.length) {
      console.error('UI drift: use existing primitives/tokens. See docs/ui-agent-guide.md. Do not disable the guard or reset its baseline.')
      process.exitCode = 1
    } else console.log(`UI drift: no added literal violations in ${result.files} changed UI files (base ${result.base.slice(0, 12)}). Visual review still required.`)
  } catch (error) {
    console.error(`UI drift check failed: ${error.message}`)
    process.exitCode = 1
  }
}
