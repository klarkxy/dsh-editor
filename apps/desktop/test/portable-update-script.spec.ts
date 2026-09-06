import { describe, expect, it } from 'vitest'
import { buildPortableSwapScript } from '../src/portable-update-script.js'

const PID = 12345
const TARGET = 'C:\\Users\\me\\Apps\\DSH Editor-0.1.5-win-x64.exe'
const NEW_EXE = 'C:\\Users\\me\\AppData\\Local\\Temp\\dsh-editor-update\\DSH-Editor-0.2.0-win-x64.exe'

describe('buildPortableSwapScript', () => {
  const script = buildPortableSwapScript(PID, TARGET, NEW_EXE)

  it('uses CRLF line endings so cmd parses labels correctly', () => {
    expect(script).toContain('\r\n')
    expect(script).not.toMatch(/[^\r]\n/)
  })

  it('waits for the app PID before touching the exe', () => {
    expect(script).toContain(`tasklist /FI "PID eq ${PID}"`)
    expect(script.indexOf('tasklist')).toBeLessThan(script.indexOf('del "%TARGET%"'))
  })

  it('quotes every path and replaces the target with the downloaded file', () => {
    expect(script).toContain(`set "TARGET=${TARGET}"`)
    expect(script).toContain(`set "NEW=${NEW_EXE}"`)
    expect(script).toContain('del "%TARGET%"')
    expect(script).toContain('move /y "%NEW%" "%TARGET%"')
    expect(script).toContain('start "" "%TARGET%"')
  })

  it('retries the delete until the file lock is released, then moves and restarts in order', () => {
    const del = script.indexOf('del "%TARGET%"')
    const move = script.indexOf('move /y')
    const start = script.indexOf('start ""')
    expect(del).toBeGreaterThan(-1)
    expect(move).toBeGreaterThan(del)
    expect(start).toBeGreaterThan(move)
    expect(script).toContain('goto replace')
  })

  it('deletes itself at the end', () => {
    expect(script).toContain('del "%~f0"')
  })
})
