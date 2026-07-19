import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../tools/win-crash-survival-e2e/cli-args.mjs'
import { buildCrashAssertions } from '../../tools/win-crash-survival-e2e/crash-assertions.mjs'
import { scanPwshFailFast } from '../../tools/win-crash-survival-e2e/crash-step.mjs'
import { selectScopedDaemon } from '../../tools/win-crash-survival-e2e/daemon-identity.mjs'
import { quotePowerShellLiteral } from '../../tools/win-update-e2e/powershell-runner.mjs'
import { resolveElectronMainPid } from '../../tools/win-update-e2e/app-driver.mjs'

describe('win-crash-survival-e2e proof contracts', () => {
  it('keeps the packaged proof wired as a targeted pull-request gate', () => {
    const workflow = readFileSync('.github/workflows/win-crash-survival-e2e.yml', 'utf8')
    expect(workflow).toMatch(/^  pull_request:/m)
    expect(workflow).not.toMatch(/^  push:/m)
    expect(workflow).toContain("- 'src/main/daemon/**'")
    expect(workflow).toContain('--expect "$env:EXPECT"')
    expect(workflow).toContain('exit $LASTEXITCODE')
  })

  it('requires the full survival oracle, including daemon identity and reattach', () => {
    const base = {
      profile: 'survival',
      mainDied: true,
      daemonAliveAfterCrash: true,
      shellAliveAfterCrash: true,
      failFastEvents: [],
      preDaemonPid: 101,
      postDaemonPid: 101,
      postDaemonAlive: true,
      reattachProven: true
    }
    expect(buildCrashAssertions(base).every((entry) => entry.pass)).toBe(true)
    expect(
      buildCrashAssertions({ ...base, postDaemonPid: 202 }).find((entry) =>
        entry.name.startsWith('relaunch adopts')
      )?.pass
    ).toBe(false)
    expect(
      buildCrashAssertions({ ...base, reattachProven: false }).find((entry) =>
        entry.name.startsWith('reattached UI')
      )?.pass
    ).toBe(false)
  })

  it('fails closed when the Windows event log query fails', () => {
    let command = ''
    expect(() =>
      scanPwshFailFast(1234, (received) => {
        command = received
        return { code: 1, stdout: '', stderr: 'access denied', error: null }
      })
    ).toThrow('pwsh-failfast scan failed (exit 1): access denied')
    expect(command).toContain('-ErrorAction Stop')
    expect(command).toContain('NoMatchingEventsFound*')
  })

  it('accepts an empty event result only after a successful query', () => {
    expect(
      scanPwshFailFast(1234, () => ({ code: 0, stdout: '', stderr: '', error: null }))
    ).toEqual({ events: [] })
  })

  it('uses the scoped live process as daemon authority', () => {
    expect(
      selectScopedDaemon(
        [{ pid: 42, appVersion: '1.2.3' }],
        [{ pid: 42, commandLine: 'daemon-entry.js --socket scoped' }]
      )
    ).toEqual({ pid: 42, appVersion: '1.2.3' })
    expect(() =>
      selectScopedDaemon(
        [{ pid: 41, appVersion: 'stale' }],
        [{ pid: 42, commandLine: 'daemon-entry.js --socket scoped' }]
      )
    ).toThrow('daemon PID file does not match scoped live daemon 42')
    expect(() => selectScopedDaemon([], [])).toThrow('expected exactly one')
    expect(() => selectScopedDaemon([], [{ pid: 1 }, { pid: 2 }])).toThrow('expected exactly one')
  })

  it('rejects CLI typos and duplicate value flags before launching', () => {
    const baseArgs = ['--expect', 'survival', '--exe-path', process.execPath]
    expect(parseArgs(baseArgs).errors).toEqual([])
    expect(parseArgs([...baseArgs, '--exe-pathh', process.execPath]).errors).toContain(
      'Unknown argument: --exe-pathh'
    )
    expect(parseArgs([...baseArgs, '--expect', 'orphaned']).errors).toContain(
      'Duplicate argument: --expect'
    )
  })

  it('quotes apostrophes in generated PowerShell path literals', () => {
    expect(quotePowerShellLiteral("C:\\Users\\O'Brien\\shell.pid")).toBe(
      "'C:\\Users\\O''Brien\\shell.pid'"
    )
  })

  it('resolves the real packaged main before falling back to the launcher child', async () => {
    expect(
      await resolveElectronMainPid({
        evaluate: async () => 222,
        process: () => ({ pid: 111 })
      })
    ).toBe(222)
    expect(
      await resolveElectronMainPid({
        evaluate: async () => {
          throw new Error('main unavailable')
        },
        process: () => ({ pid: 111 })
      })
    ).toBe(111)
  })
})
