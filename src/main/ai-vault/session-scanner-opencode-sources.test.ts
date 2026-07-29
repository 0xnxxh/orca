import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { opencodeDiscoveries } from './session-scanner-opencode-sources'

const { discoverOpenCodeSessionsMock, listOpenCodeDatabasesMock } = vi.hoisted(() => ({
  discoverOpenCodeSessionsMock: vi.fn(),
  listOpenCodeDatabasesMock: vi.fn()
}))

vi.mock('./session-scanner-opencode-sqlite-discovery', () => ({
  discoverOpenCodeSessions: discoverOpenCodeSessionsMock
}))

vi.mock('../opencode-usage/scanner', () => ({
  listOpenCodeDatabases: listOpenCodeDatabasesMock
}))

describe('opencodeDiscoveries', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('prefers the OpenCode config directory for local storage', async () => {
    vi.stubEnv('XDG_DATA_HOME', '/xdg/data')
    vi.stubEnv('OPENCODE_CONFIG_DIR', ' /opencode/config ')
    listOpenCodeDatabasesMock.mockResolvedValue([])
    discoverOpenCodeSessionsMock.mockResolvedValue({
      agent: 'opencode',
      rootDir: '/opencode/config/storage',
      files: []
    })
    const issues = []

    await Promise.all(opencodeDiscoveries({}, [], 25, issues))

    expect(discoverOpenCodeSessionsMock).toHaveBeenCalledWith({
      storageDir: join('/opencode/config', 'storage'),
      dbPaths: [],
      limitPerAgent: 25,
      issues
    })
  })

  it('keeps WSL discovery on the guest data path', async () => {
    vi.stubEnv('OPENCODE_CONFIG_DIR', '/windows/opencode/config')
    discoverOpenCodeSessionsMock.mockResolvedValue({
      agent: 'opencode',
      rootDir: '/home/wsl/.local/share/opencode/storage',
      files: []
    })
    const issues = []

    await Promise.all(opencodeDiscoveries({ opencodeDbPaths: [] }, ['/home/wsl'], 25, issues))

    expect(discoverOpenCodeSessionsMock).toHaveBeenNthCalledWith(1, {
      storageDir: join('/windows/opencode/config', 'storage'),
      dbPaths: [],
      limitPerAgent: 25,
      issues
    })
    expect(discoverOpenCodeSessionsMock).toHaveBeenNthCalledWith(2, {
      storageDir: join('/home/wsl', '.local', 'share', 'opencode', 'storage'),
      dbPaths: [],
      limitPerAgent: 25,
      issues
    })
  })

  it('falls back to the OpenCode XDG data directory', async () => {
    vi.stubEnv('XDG_DATA_HOME', '/xdg/data')
    vi.stubEnv('OPENCODE_CONFIG_DIR', '   ')
    listOpenCodeDatabasesMock.mockResolvedValue([])
    discoverOpenCodeSessionsMock.mockResolvedValue({
      agent: 'opencode',
      rootDir: '/xdg/data/opencode/storage',
      files: []
    })
    const issues = []

    await Promise.all(opencodeDiscoveries({}, [], 25, issues))

    expect(discoverOpenCodeSessionsMock).toHaveBeenCalledWith({
      storageDir: join('/xdg/data', 'opencode', 'storage'),
      dbPaths: [],
      limitPerAgent: 25,
      issues
    })
  })
})
