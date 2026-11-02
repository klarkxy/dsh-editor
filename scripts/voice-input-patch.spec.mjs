import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { resolveDshInstallation } from './dsh-cli.mjs'

// Verify the installed patched voice client, like the plugin-manager patch spec:
// assert on the real artifact so a failed patch application cannot pass silently.
const installation = resolveDshInstallation()
const require = createRequire(join(installation.packageRoot, 'package.json'))
const entry = require.resolve('@deepseek-ai/dsh-experimental-client-ui-voice-input')
const source = readFileSync(join(dirname(entry), 'client.js'), 'utf8')
const parsed = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
expect(parsed.parseDiagnostics).toEqual([])

describe('pinned voice input picker patch', () => {
  it('gates microphone acquisition behind an explicit preview toggle', () => {
    expect(source).toContain('const [wanted, setWanted] = (0, react.useState)(false);')
    // The only acquisition site runs under the explicit opt-in flag; mounting or
    // re-entering the page must never call acquire().
    expect(source).toContain('} else if (wanted && !document.hidden && !capture) acquire();')
    expect(source).not.toContain('} else if (!document.hidden && !capture) acquire();')
    // Device selection and the toggle both re-run the effect, which releases the
    // previous capture before acquiring again.
    expect(source).toContain('}, [selected.id, createRecording, wanted]);')
  })

  it('renders a localized preview toggle next to the device picker', () => {
    expect(source).toContain('onClick: () => setWanted((previous) => !previous),')
    expect(source).toContain('children: preview ? t("previewStop") : t("previewStart")')
    expect(source).toContain('previewStart: "测试麦克风",')
    expect(source).toContain('previewStop: "停止测试",')
    expect(source).toContain('previewStart: "Test microphone",')
    expect(source).toContain('previewStop: "Stop test",')
  })
})
