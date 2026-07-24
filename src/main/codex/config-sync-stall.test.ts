import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCodexConfigSyncStatus,
  resetCodexConfigSyncStallLatchForTests
} from './config-sync-stall'
import { syncSystemConfigIntoManagedCodexHome } from './codex-config-mirror'

let root: string
let homes: { runtimeHomePath: string; systemHomePath: string }

function systemConfigPath(): string {
  return join(homes.systemHomePath, 'config.toml')
}

function runtimeConfigPath(): string {
  return join(homes.runtimeHomePath, 'config.toml')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-codex-sync-stall-'))
  homes = { runtimeHomePath: join(root, 'runtime'), systemHomePath: join(root, 'system') }
  mkdirSync(homes.runtimeHomePath, { recursive: true })
  mkdirSync(homes.systemHomePath, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('getCodexConfigSyncStatus', () => {
  it('reports synced while the source config is usable', () => {
    writeFileSync(systemConfigPath(), 'model = "gpt-5"\n', 'utf-8')
    writeFileSync(runtimeConfigPath(), 'model = "gpt-5"\n', 'utf-8')

    expect(getCodexConfigSyncStatus(homes)).toEqual({
      state: 'synced',
      reason: null,
      systemConfigPath: systemConfigPath()
    })
  })

  it('reports a stall when the source config is missing', () => {
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')

    expect(getCodexConfigSyncStatus(homes)).toEqual({
      state: 'stalled',
      reason: 'missing-source',
      systemConfigPath: systemConfigPath()
    })
  })

  it('reports a stall when the source config is blank', () => {
    writeFileSync(systemConfigPath(), '\n  \n', 'utf-8')
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')

    expect(getCodexConfigSyncStatus(homes).reason).toBe('blank-source')
  })

  it('reports a stall when the source config cannot be read', () => {
    // Why: a directory at the config path survives existsSync but throws on
    // read, standing in for a permission-denied or otherwise unreadable home.
    mkdirSync(systemConfigPath(), { recursive: true })
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')

    expect(getCodexConfigSyncStatus(homes).reason).toBe('unreadable-source')
  })

  it('stays synced before the runtime config exists, since nothing can fall behind yet', () => {
    expect(getCodexConfigSyncStatus(homes)).toEqual({
      state: 'synced',
      reason: null,
      systemConfigPath: systemConfigPath()
    })
  })

  // Why: the status must never claim a sync the mirror would decline, so pin it
  // to the mirror's real behavior rather than to a duplicated predicate.
  it('reports a stall exactly when the mirror preserves the runtime config', () => {
    writeFileSync(systemConfigPath(), 'model = "gpt-5"\n', 'utf-8')
    syncSystemConfigIntoManagedCodexHome(homes)
    expect(getCodexConfigSyncStatus(homes).state).toBe('synced')

    rmSync(systemConfigPath())
    syncSystemConfigIntoManagedCodexHome(homes)

    expect(getCodexConfigSyncStatus(homes).state).toBe('stalled')
    // The mirror keeps serving the last good settings — that is what makes the
    // stall silent, and why it needs surfacing.
    expect(readFileSync(runtimeConfigPath(), 'utf-8')).toContain('model = "gpt-5"')
  })

  it('clears the stall once the source config returns', () => {
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')
    expect(getCodexConfigSyncStatus(homes).state).toBe('stalled')

    writeFileSync(systemConfigPath(), 'model = "gpt-5"\n', 'utf-8')

    expect(getCodexConfigSyncStatus(homes).state).toBe('synced')
  })
})

describe('reportCodexConfigSyncOutcome', () => {
  beforeEach(() => {
    resetCodexConfigSyncStallLatchForTests()
  })

  it('logs a stall once per episode rather than on every sync pass', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')

    for (let pass = 0; pass < 3; pass += 1) {
      syncSystemConfigIntoManagedCodexHome(homes)
    }

    expect(warn.mock.calls.filter((call) => String(call[0]).includes('stalled'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('logs the recovery once the source config returns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')
    syncSystemConfigIntoManagedCodexHome(homes)

    writeFileSync(systemConfigPath(), 'model = "gpt-5"\n', 'utf-8')
    syncSystemConfigIntoManagedCodexHome(homes)
    syncSystemConfigIntoManagedCodexHome(homes)

    expect(warn.mock.calls.filter((call) => String(call[0]).includes('recovered'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('logs again when the stall reason changes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(runtimeConfigPath(), 'model = "runtime-model"\n', 'utf-8')
    syncSystemConfigIntoManagedCodexHome(homes)

    writeFileSync(systemConfigPath(), '   \n', 'utf-8')
    syncSystemConfigIntoManagedCodexHome(homes)

    const stallLogs = warn.mock.calls.filter((call) => String(call[0]).includes('stalled'))
    expect(stallLogs).toHaveLength(2)
    expect(String(stallLogs[1]?.[0])).toContain('blank-source')
    warn.mockRestore()
  })
})
