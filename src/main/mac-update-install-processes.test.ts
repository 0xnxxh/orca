import { describe, expect, it } from 'vitest'
import type { MacUpdateInstallFence } from '../shared/mac-update-install-fence'
import {
  classifyMacProductionBlockerForTest,
  commandMatchesShipItForTest,
  parseMacProcessTableForTest
} from './mac-update-install-processes'

const EXECUTABLE = '/Applications/Orca.app/Contents/MacOS/Orca'
const FENCE: MacUpdateInstallFence = {
  schemaVersion: 1,
  attemptId: '10c7f74f-254c-4e11-8201-3d96db410246',
  bundleIdentifier: 'com.stablyai.orca',
  sourceVersion: '1.0.0',
  targetVersion: '1.0.1',
  targetBundlePath: '/Applications/Orca.app',
  shipItStatePath: '/Users/test/Library/Caches/com.stablyai.orca.ShipIt/ShipItState.plist',
  sourcePid: 100,
  monitorPid: 101,
  phase: 'armed',
  createdAt: 1,
  heartbeatAt: 1,
  lastTransitionAt: 1,
  absoluteExpiresAt: 2
}

describe('mac update install process matching', () => {
  it('classifies GUI and serve mains without exposing argv', () => {
    const records = parseMacProcessTableForTest(
      `  10 ${EXECUTABLE}\n  11 ${EXECUTABLE} --serve --serve-json\n`
    )
    expect(
      classifyMacProductionBlockerForTest(records, {
        executablePath: EXECUTABLE,
        excludedPids: new Set([10])
      })
    ).toEqual({ pid: 11, mode: 'serve' })
  })

  it('excludes packaged CLI and internal node-mode entries', () => {
    const records = parseMacProcessTableForTest(
      [
        `20 ${EXECUTABLE} /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/index.js claude-teams`,
        `21 ${EXECUTABLE} /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/main/daemon-entry.js`,
        `22 ${EXECUTABLE} --orca-update-fence-monitor ${FENCE.attemptId}`
      ].join('\n')
    )
    expect(
      classifyMacProductionBlockerForTest(records, {
        executablePath: EXECUTABLE,
        excludedPids: new Set()
      })
    ).toBeNull()
  })

  it('matches ShipIt only with its executable, bundle id, and exact state path', () => {
    const command =
      '/Applications/Orca.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt ' +
      `com.stablyai.orca.ShipIt "${FENCE.shipItStatePath}"`
    expect(commandMatchesShipItForTest(command, FENCE)).toBe(true)
    expect(commandMatchesShipItForTest(command.replace('orca.ShipIt', 'other.ShipIt'), FENCE)).toBe(
      false
    )
    expect(commandMatchesShipItForTest(command.replace('ShipItState', 'OtherState'), FENCE)).toBe(
      false
    )
  })

  it('still matches ShipIt when the bundle path contains spaces', () => {
    // ps does not quote argv, so tokenization cannot recover a spaced argv0;
    // the raw-substring fallback must keep the installer visible.
    const command =
      '/Users/test/My Apps/Orca.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt ' +
      `com.stablyai.orca.ShipIt ${FENCE.shipItStatePath}`
    expect(commandMatchesShipItForTest(command, FENCE)).toBe(true)
    expect(commandMatchesShipItForTest(command.replace('ShipItState', 'OtherState'), FENCE)).toBe(
      false
    )
  })
})
