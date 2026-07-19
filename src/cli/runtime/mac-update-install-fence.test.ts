import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MacUpdateInstallFence } from '../../shared/mac-update-install-fence'

const mocks = vi.hoisted(() => ({
  homedir: vi.fn(() => '/nonexistent'),
  execFile: vi.fn()
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, homedir: mocks.homedir }
})
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))

import { assertMacUpdateInstallLaunchAllowed } from './mac-update-install-fence'
import { RuntimeClientError } from './types'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

let home: string
let bundlePath: string

function writeFence(overrides: Partial<MacUpdateInstallFence> = {}): MacUpdateInstallFence {
  const now = Date.now()
  const fence: MacUpdateInstallFence = {
    schemaVersion: 1,
    attemptId: '9be0f7c8-5e0e-4a3e-9f52-8b04a41f2f1c',
    bundleIdentifier: 'com.stablyai.orca',
    sourceVersion: '1.0.0',
    targetVersion: '1.0.1',
    targetBundlePath: bundlePath,
    shipItStatePath: join(
      home,
      'Library',
      'Caches',
      'com.stablyai.orca.ShipIt',
      'ShipItState.plist'
    ),
    sourcePid: 4321,
    monitorPid: 4322,
    phase: 'awaiting-shipit',
    createdAt: now - 10_000,
    heartbeatAt: now - 1_000,
    lastTransitionAt: now - 5_000,
    absoluteExpiresAt: now + 20 * 60_000,
    ...overrides
  }
  writeFileSync(
    join(home, 'Library', 'Application Support', 'com.stablyai.orca', 'orca-install-fence-v1.json'),
    `${JSON.stringify(fence)}\n`
  )
  return fence
}

function stubProcessOutputs(psOutput: string): void {
  mocks.execFile.mockImplementation(
    (
      command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      if (command === '/usr/bin/plutil') {
        callback(null, '1.0.0\n', '')
      } else {
        callback(null, psOutput, '')
      }
    }
  )
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  home = mkdtempSync(join(tmpdir(), 'orca-cli-fence-'))
  mkdirSync(join(home, 'Library', 'Application Support', 'com.stablyai.orca'), { recursive: true })
  bundlePath = join(realpathSync.native(home), 'Orca.app')
  mkdirSync(bundlePath, { recursive: true })
  mocks.homedir.mockReturnValue(home)
  stubProcessOutputs('')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  delete process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE
})

afterAll(() => {
  if (platformDescriptor) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
})

describe('cli mac update install launch fence', () => {
  it('blocks a launch while an install lease is fresh', async () => {
    writeFence()

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: false
      })
    ).rejects.toMatchObject({ code: 'update_install_in_progress' })
    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: false
      })
    ).rejects.toBeInstanceOf(RuntimeClientError)
  })

  it('allows activating the still-running source app while the fence is armed', async () => {
    const fence = writeFence({ phase: 'armed' })
    stubProcessOutputs(`  ${fence.sourcePid} ${bundlePath}/Contents/MacOS/Orca -psn_0_1\n`)

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: true
      })
    ).resolves.toBeUndefined()
  })

  it('still blocks new processes while the fence is armed', async () => {
    writeFence({ phase: 'armed' })

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: false
      })
    ).rejects.toMatchObject({ code: 'update_install_in_progress' })
  })

  it('still blocks when the bundle version is unreadable mid-install', async () => {
    // Why: an unreadable Info.plist is exactly the ShipIt mid-swap window; it
    // must fail toward the heartbeat block, not the incomparable_version bypass.
    writeFence()
    mocks.execFile.mockImplementation(
      (
        command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (command === '/usr/bin/plutil') {
          callback(new Error('Info.plist is missing'), '', '')
        } else {
          callback(null, '', '')
        }
      }
    )

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: false
      })
    ).rejects.toMatchObject({ code: 'update_install_in_progress' })
  })

  it('does not fail armed activation closed when the process probe errors', async () => {
    writeFence({ phase: 'armed' })
    mocks.execFile.mockImplementation(
      (
        command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (command === '/usr/bin/plutil') {
          callback(null, '1.0.0\n', '')
        } else {
          callback(new Error('ps failed'), '', '')
        }
      }
    )

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: true
      })
    ).resolves.toBeUndefined()
  })

  it('honors the kill switch for enforcement', async () => {
    writeFence()
    process.env.ORCA_DISABLE_MAC_UPDATE_INSTALL_FENCE = '1'

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: false
      })
    ).resolves.toBeUndefined()
  })

  it('fails open on malformed fence state', async () => {
    writeFileSync(
      join(
        home,
        'Library',
        'Application Support',
        'com.stablyai.orca',
        'orca-install-fence-v1.json'
      ),
      'not json'
    )

    await expect(
      assertMacUpdateInstallLaunchAllowed({
        targetBundlePath: bundlePath,
        allowArmedActivation: false
      })
    ).resolves.toBeUndefined()
  })
})
