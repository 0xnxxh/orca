import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as NodeOs from 'node:os'

const testState = { userData: '', home: '' }
const previousEnv: Record<string, string | undefined> = {}

vi.mock('electron', () => ({ app: { getPath: () => testState.userData } }))
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: () => testState.home }
})

function systemHome(): string {
  return join(testState.home, '.codex')
}

function overlayHomePath(): string {
  const home = join(testState.userData, 'codex-accounts', 'account-1', 'home')
  mkdirSync(home, { recursive: true })
  return home
}

beforeEach(() => {
  vi.resetModules()
  testState.userData = mkdtempSync(join(tmpdir(), 'orca-overlay-hooks-data-'))
  testState.home = mkdtempSync(join(tmpdir(), 'orca-overlay-hooks-home-'))
  previousEnv.ORCA_USER_DATA_PATH = process.env.ORCA_USER_DATA_PATH
  previousEnv.ORCA_DISABLE_CODEX_TRUST_RPC = process.env.ORCA_DISABLE_CODEX_TRUST_RPC
  process.env.ORCA_USER_DATA_PATH = testState.userData
  mkdirSync(systemHome(), { recursive: true })
})

afterEach(() => {
  rmSync(testState.userData, { recursive: true, force: true })
  rmSync(testState.home, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

async function writeManagedHooksJson(overlayHome: string): Promise<void> {
  const { getCodexManagedHookInstallMaterial } = await import('../codex/hook-service')
  const material = getCodexManagedHookInstallMaterial()
  const [firstEvent] = material.events
  writeFileSync(
    join(overlayHome, 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        [firstEvent]: [{ hooks: [{ type: 'command', command: material.command }] }]
      }
    })}\n`,
    'utf-8'
  )
}

describe('overlay hook trust', () => {
  it('derives managed hook trust entries keyed to the canonicalized overlay home', async () => {
    const overlayHome = overlayHomePath()
    await writeManagedHooksJson(overlayHome)
    const { findManagedOverlayHookTrustEntries } = await import('./overlay-hook-trust')
    const { getCodexExplicitHomeHookSourcePath } = await import('../codex/config-toml-trust')

    const entries = findManagedOverlayHookTrustEntries(overlayHome)

    expect(entries.length).toBe(1)
    expect(entries[0].sourcePath).toBe(
      getCodexExplicitHomeHookSourcePath(join(overlayHome, 'hooks.json'))
    )
    expect(entries[0].groupIndex).toBe(0)
    expect(entries[0].handlerIndex).toBe(0)
  })

  it('returns no entries (and grant no-ops) when the shared hooks.json has no Orca hook', async () => {
    const overlayHome = overlayHomePath()
    writeFileSync(join(overlayHome, 'hooks.json'), '{"hooks":{}}\n', 'utf-8')
    const { findManagedOverlayHookTrustEntries, grantManagedCodexOverlayHookTrust } =
      await import('./overlay-hook-trust')

    expect(findManagedOverlayHookTrustEntries(overlayHome)).toEqual([])
    // Never throws, even with no entries and no configured app-server.
    expect(() => grantManagedCodexOverlayHookTrust(overlayHome)).not.toThrow()
  })

  it('sweeps only the overlay-owned [hooks.state] entry from the shared real config', async () => {
    process.env.ORCA_DISABLE_CODEX_TRUST_RPC = '1'
    const overlayHome = overlayHomePath()
    await writeManagedHooksJson(overlayHome)

    const { getCodexManagedHookInstallMaterial } = await import('../codex/hook-service')
    const { MANAGED_HOOK_TIMEOUT_SECONDS } = await import('../agent-hooks/installer-utils')
    const {
      computeTrustKey,
      computeTrustedHash,
      escapeTomlString,
      getCodexExplicitHomeHookSourcePath
    } = await import('../codex/config-toml-trust')
    const material = getCodexManagedHookInstallMaterial()
    const [firstEvent] = material.events
    const managedEntry = {
      sourcePath: getCodexExplicitHomeHookSourcePath(join(overlayHome, 'hooks.json')),
      eventLabel: material.eventLabel[firstEvent],
      groupIndex: 0,
      handlerIndex: 0,
      command: material.command,
      timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
    }
    const userKey = `${join(systemHome(), 'hooks.json')}:stop:0:0`
    const realConfigPath = join(systemHome(), 'config.toml')
    writeFileSync(
      realConfigPath,
      [
        'approval_policy = "never"',
        '',
        `[hooks.state."${escapeTomlString(computeTrustKey(managedEntry))}"]`,
        'enabled = true',
        `trusted_hash = "${computeTrustedHash(managedEntry)}"`,
        '',
        `[hooks.state."${escapeTomlString(userKey)}"]`,
        'enabled = true',
        'trusted_hash = "sha256:user-owned"'
      ].join('\n'),
      'utf-8'
    )

    const { sweepManagedCodexOverlayHookTrust } = await import('./overlay-hook-trust')
    sweepManagedCodexOverlayHookTrust(overlayHome)

    const realConfig = readFileSync(realConfigPath, 'utf-8')
    // The overlay's Orca-owned entry is gone; the user's own trust remains.
    expect(realConfig).not.toContain(computeTrustKey(managedEntry))
    expect(realConfig).toContain(userKey)
    expect(realConfig).toContain('approval_policy = "never"')
  })
})
