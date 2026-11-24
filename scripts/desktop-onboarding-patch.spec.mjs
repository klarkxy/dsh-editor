import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { resolveDshInstallation } from './dsh-cli.mjs'

// Pinned patch on @deepseek-ai/dsh-client-ui-settings-account@0.2.2-rc.5:
// the desktop onboarding entry used to cover the whole workspace with a
// 「正在加载设置…」 surface while the onboarding controller was still loading,
// even when no onboarding would ever be shown. The patch makes it render
// nothing and report visible=false until a real onboarding state arrives.
const installation = resolveDshInstallation()
const require = createRequire(join(installation.packageRoot, 'package.json'))
const entry = require.resolve('@deepseek-ai/dsh-client-ui-settings-account')
const source = readFileSync(join(dirname(entry), 'client.js'), 'utf8')
const parsed = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
expect(parsed.parseDiagnostics).toEqual([])

describe('pinned desktop onboarding loading cover patch', () => {
  it('reports hidden while the onboarding controller is still loading', () => {
    // visibility only follows a displayed onboarding state now.
    expect(source).toContain('const visible=displayed!==null;')
    expect(source).not.toContain('const visible=displayed!==null||state.status===`loading`')
  })

  it('renders nothing instead of the loading surface while nothing is displayed', () => {
    expect(source).toContain('if(displayed===null)return null;')
    expect(source).not.toContain('state.status===`loading`?(0,react_jsx_runtime.jsx)(OnboardingSurface')
    // The localized loading copy still ships for other surfaces.
    expect(source).toContain('onboardingLoading:`正在加载设置…`')
  })
})
