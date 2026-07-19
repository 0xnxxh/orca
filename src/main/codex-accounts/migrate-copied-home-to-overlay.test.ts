import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as NodeOs from 'node:os'
import type { CodexManagedAccount } from '../../shared/types'

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

function managedAccountsRoot(): string {
  return join(testState.userData, 'codex-accounts')
}

function metadataDir(): string {
  return join(testState.userData, 'codex-runtime-home')
}

function createCopiedManagedHome(accountId: string, copiedConfig: string): string {
  const home = join(managedAccountsRoot(), accountId, 'home')
  mkdirSync(join(home, 'sessions', '2026'), { recursive: true })
  writeFileSync(join(home, '.orca-managed-home'), `${accountId}\n`, 'utf-8')
  writeFileSync(join(home, 'auth.json'), '{"account":"managed"}\n', 'utf-8')
  writeFileSync(join(home, 'models_cache.json'), '{"models":["gpt-5.2"]}\n', 'utf-8')
  writeFileSync(join(home, '.credentials.json'), '{"mcp":"token"}\n', 'utf-8')
  writeFileSync(join(home, 'sessions', '2026', 'rollout.jsonl'), '{"session":"a"}\n', 'utf-8')
  writeFileSync(join(home, 'config.toml'), copiedConfig, 'utf-8')
  return home
}

function managedAccountRecord(id: string, managedHomePath: string): CodexManagedAccount {
  return {
    id,
    email: 'user@example.com',
    managedHomePath,
    providerAccountId: 'acct',
    workspaceLabel: null,
    workspaceAccountId: 'acct',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  } as CodexManagedAccount
}

beforeEach(() => {
  vi.resetModules()
  testState.userData = mkdtempSync(join(tmpdir(), 'orca-overlay-mig-data-'))
  testState.home = mkdtempSync(join(tmpdir(), 'orca-overlay-mig-home-'))
  for (const key of ['ORCA_USER_DATA_PATH', 'ORCA_DISABLE_CODEX_TRUST_RPC']) {
    previousEnv[key] = process.env[key]
  }
  process.env.ORCA_USER_DATA_PATH = testState.userData
  // Why: keep the overlay hook grant on its offline fallback so the migration
  // test never spawns a real codex app-server.
  process.env.ORCA_DISABLE_CODEX_TRUST_RPC = '1'
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

async function runMigration(accounts: CodexManagedAccount[]): Promise<void> {
  const { migrateCopiedManagedHomesToOverlay } = await import('./migrate-copied-home-to-overlay')
  migrateCopiedManagedHomesToOverlay({
    hostAccounts: accounts,
    managedAccountsRoot: managedAccountsRoot(),
    metadataDir: metadataDir(),
    systemCodexHome: systemHome()
  })
}

describe('migrateCopiedManagedHomesToOverlay', () => {
  it('converts a copied home to an overlay, preserving real per-account files', async () => {
    writeFileSync(join(systemHome(), 'config.toml'), 'approval_policy = "never"\n', 'utf-8')
    const home = createCopiedManagedHome('account-1', 'approval_policy = "on-request"\n')

    await runMigration([managedAccountRecord('account-1', home)])

    // Real, per-account files are untouched.
    expect(readFileSync(join(home, 'auth.json'), 'utf-8')).toBe('{"account":"managed"}\n')
    expect(readFileSync(join(home, 'models_cache.json'), 'utf-8')).toBe('{"models":["gpt-5.2"]}\n')
    expect(readFileSync(join(home, '.credentials.json'), 'utf-8')).toBe('{"mcp":"token"}\n')
    expect(readFileSync(join(home, 'sessions', '2026', 'rollout.jsonl'), 'utf-8')).toBe(
      '{"session":"a"}\n'
    )
    expect(lstatSync(join(home, 'auth.json')).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(home, 'sessions')).isSymbolicLink()).toBe(false)

    // config.toml is now an overlay symlink to the shared real config.
    expect(lstatSync(join(home, 'config.toml')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toBe('approval_policy = "never"\n')

    // The pre-migration copied config is archived for recovery, and the one-shot
    // marker is written.
    expect(
      readFileSync(
        join(metadataDir(), 'copied-home-overlay-archive', 'account-1', 'config.toml'),
        'utf-8'
      )
    ).toBe('approval_policy = "on-request"\n')
    expect(existsSync(join(metadataDir(), 'per-account-overlay-migration-v1.json'))).toBe(true)
  })

  it('promotes user project trust from the copied config once, without Orca hook trust', async () => {
    writeFileSync(join(systemHome(), 'config.toml'), 'approval_policy = "never"\n', 'utf-8')
    const projectPath = join(testState.userData, 'workspace', 'repo')
    mkdirSync(projectPath, { recursive: true })
    const copiedConfig = [
      'approval_policy = "on-request"',
      '',
      `[projects."${projectPath}"]`,
      'trust_level = "trusted"',
      '',
      '[hooks.state."orca-managed-key"]',
      'enabled = true',
      'trusted_hash = "sha256:orca"'
    ].join('\n')
    const home = createCopiedManagedHome('account-1', copiedConfig)

    await runMigration([managedAccountRecord('account-1', home)])

    const realConfig = readFileSync(join(systemHome(), 'config.toml'), 'utf-8')
    // User project trust is promoted into the shared real config.
    expect(realConfig).toContain('[projects.')
    expect(realConfig).toContain('trust_level = "trusted"')
    // Orca's managed hook trust is NOT promoted into the real config.
    expect(realConfig).not.toContain('[hooks.state')
  })

  it('does not override an existing real-config project decision', async () => {
    const projectPath = join(testState.userData, 'workspace', 'repo')
    mkdirSync(projectPath, { recursive: true })
    writeFileSync(
      join(systemHome(), 'config.toml'),
      [`[projects."${projectPath}"]`, 'trust_level = "untrusted"', ''].join('\n'),
      'utf-8'
    )
    const copiedConfig = [`[projects."${projectPath}"]`, 'trust_level = "trusted"'].join('\n')
    const home = createCopiedManagedHome('account-1', copiedConfig)

    await runMigration([managedAccountRecord('account-1', home)])

    // The user's real-config revocation wins; migration never resurrects trust.
    const realConfig = readFileSync(join(systemHome(), 'config.toml'), 'utf-8')
    expect(realConfig).toContain('trust_level = "untrusted"')
    expect(realConfig).not.toContain('trust_level = "trusted"')
  })

  it('promotes through a dotfiles-managed real config symlink without replacing the link', async () => {
    const { symlinkSync } = await import('node:fs')
    const dotfilesConfigPath = join(testState.home, 'dotfiles-config.toml')
    writeFileSync(dotfilesConfigPath, 'approval_policy = "never"\n', 'utf-8')
    symlinkSync(dotfilesConfigPath, join(systemHome(), 'config.toml'))
    const projectPath = join(testState.userData, 'workspace', 'repo')
    mkdirSync(projectPath, { recursive: true })
    const copiedConfig = [`[projects."${projectPath}"]`, 'trust_level = "trusted"'].join('\n')
    const home = createCopiedManagedHome('account-1', copiedConfig)

    await runMigration([managedAccountRecord('account-1', home)])

    // The user's dotfiles link survives; the promotion landed in its target.
    expect(lstatSync(join(systemHome(), 'config.toml')).isSymbolicLink()).toBe(true)
    expect(readFileSync(dotfilesConfigPath, 'utf-8')).toContain('trust_level = "trusted"')
  })

  it('is one-shot — a second run does not re-promote or re-archive', async () => {
    writeFileSync(join(systemHome(), 'config.toml'), 'approval_policy = "never"\n', 'utf-8')
    const home = createCopiedManagedHome('account-1', 'approval_policy = "on-request"\n')
    await runMigration([managedAccountRecord('account-1', home)])

    // Change the archived-away copied config's symlink target should not matter;
    // a second run must early-return on the marker.
    const archivePath = join(
      metadataDir(),
      'copied-home-overlay-archive',
      'account-1',
      'config.toml'
    )
    const archiveBefore = readFileSync(archivePath, 'utf-8')
    await runMigration([managedAccountRecord('account-1', home)])
    expect(readFileSync(archivePath, 'utf-8')).toBe(archiveBefore)
  })
})
