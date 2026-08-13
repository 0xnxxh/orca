import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultListResult, AiVaultSession } from '../../shared/ai-vault-types'
import type { IFilesystemProvider } from '../providers/types'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type { ExpectedSshAiVaultHost } from '../ai-vault/unscanned-ssh-host-issues'

const mocks = vi.hoisted(() => ({
  scanAiVaultSessionsInWorker: vi.fn(),
  resolveAiVaultSessionTitlesInWorker: vi.fn(),
  scanRemoteAiVaultSessions: vi.fn(),
  getSshFilesystemProvider: vi.fn(),
  getActiveSshAiVaultHostInfo: vi.fn(),
  getActiveSshAiVaultHostInfos: vi.fn(),
  requestActiveSshAiVaultSessionList: vi.fn(),
  requestActiveSshAiVaultSessionTitles: vi.fn(),
  ipcHandle: vi.fn()
}))

vi.mock('electron', () => ({ app: { on: vi.fn() }, ipcMain: { handle: mocks.ipcHandle } }))
vi.mock('../ai-vault/session-scanner-worker-spawn', () => ({
  scanAiVaultSessionsInWorker: mocks.scanAiVaultSessionsInWorker,
  resolveAiVaultSessionTitlesInWorker: mocks.resolveAiVaultSessionTitlesInWorker,
  resetAiVaultScannerWorkerForTests: vi.fn()
}))
vi.mock('../ai-vault/remote-session-scanner', () => ({
  scanRemoteAiVaultSessions: mocks.scanRemoteAiVaultSessions
}))
vi.mock('../wsl', () => ({
  getWslHomeAsync: vi.fn(),
  listWslDistrosAsync: vi.fn().mockResolvedValue([])
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE: 'SSH unavailable',
  getSshFilesystemProvider: mocks.getSshFilesystemProvider
}))
vi.mock('./ssh', () => ({
  getActiveSshAiVaultHostInfo: mocks.getActiveSshAiVaultHostInfo,
  getActiveSshAiVaultHostInfos: mocks.getActiveSshAiVaultHostInfos,
  requestActiveSshAiVaultSessionList: mocks.requestActiveSshAiVaultSessionList,
  requestActiveSshAiVaultSessionTitles: mocks.requestActiveSshAiVaultSessionTitles
}))

const { _internals, registerAiVaultHandlers } = await import('./ai-vault')

const LOCAL_RESULT: AiVaultListResult = {
  sessions: [session('local', 'local-1')],
  issues: [],
  scannedAt: '2026-07-27T00:00:00.000Z'
}
const SSH_RESULT: AiVaultListResult = {
  sessions: [session('ssh:dev-box', 'ssh-1')],
  issues: [],
  scannedAt: '2026-07-27T00:00:01.000Z'
}

beforeEach(() => {
  vi.clearAllMocks()
  _internals.resetAiVaultCacheForTests()
  mocks.scanAiVaultSessionsInWorker.mockResolvedValue(LOCAL_RESULT)
  mocks.resolveAiVaultSessionTitlesInWorker.mockResolvedValue({ titles: [] })
  mocks.scanRemoteAiVaultSessions.mockResolvedValue(SSH_RESULT)
  mocks.getSshFilesystemProvider.mockReturnValue({} as IFilesystemProvider)
  mocks.getActiveSshAiVaultHostInfo.mockReturnValue(hostInfo())
  mocks.getActiveSshAiVaultHostInfos.mockReturnValue([])
  mocks.requestActiveSshAiVaultSessionList.mockResolvedValue(null)
  mocks.requestActiveSshAiVaultSessionTitles.mockResolvedValue(null)
})

describe('all-host Agent Session History with an unreachable SSH host', () => {
  it('explains an SSH host that is not connected instead of silently dropping it', async () => {
    register([expectedHost('dev-box', 'disconnected')])

    const result = await _internals.listAiVaultSessions({ executionHostScope: 'all' })

    expect(result.sessions.map((entry) => entry.id)).toEqual([LOCAL_RESULT.sessions[0]?.id])
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        kind: 'scope',
        path: 'SSH hosts',
        message: expect.stringContaining('dev-box')
      })
    )
    // The notice must not remint the merged stamp; #14245/#14261 rely on it.
    expect(result.scannedAt).toBe(LOCAL_RESULT.scannedAt)
  })

  it('only names hosts that produced no leg', async () => {
    mocks.getActiveSshAiVaultHostInfos.mockReturnValue([hostInfo()])
    register([expectedHost('dev-box', 'connected'), expectedHost('gpu-1', 'disconnected')])

    const result = await _internals.listAiVaultSessions({ executionHostScope: 'all' })

    const notices = result.issues.filter((issue) => issue.path === 'SSH hosts')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.message).toContain('gpu-1')
    expect(notices[0]?.message).not.toContain('dev-box')
  })

  it('startup: a host that is still connecting gets a non-blocking notice', async () => {
    register([expectedHost('dev-box', 'connecting')])

    const result = await _internals.listAiVaultSessions({ executionHostScope: 'all' })

    const notice = result.issues.find((issue) => issue.path === 'SSH hosts')
    // 'scope' keeps this out of the destructive/blocking banner slot.
    expect(notice?.kind).toBe('scope')
    expect(notice?.message).toContain('still connecting')
  })

  it('clears the notice once the host reconnects', async () => {
    register([expectedHost('dev-box', 'reconnecting')])

    const disconnected = await _internals.listAiVaultSessions({ executionHostScope: 'all' })
    expect(disconnected.sessions.map((entry) => entry.id)).toEqual([LOCAL_RESULT.sessions[0]?.id])
    expect(disconnected.issues.some((issue) => issue.path === 'SSH hosts')).toBe(true)

    mocks.getActiveSshAiVaultHostInfos.mockReturnValue([hostInfo()])
    register([expectedHost('dev-box', 'connected')])
    // force bypasses the 15s merged/leg cache the way the panel's Refresh does.
    const reconnected = await _internals.listAiVaultSessions({
      executionHostScope: 'all',
      force: true
    })

    expect(reconnected.sessions.map((entry) => entry.id)).toContain(SSH_RESULT.sessions[0]?.id)
    expect(reconnected.issues.some((issue) => issue.path === 'SSH hosts')).toBe(false)
  })
})

function register(expectedSshHosts: readonly ExpectedSshAiVaultHost[]): void {
  registerAiVaultHandlers({ getExpectedSshAiVaultHosts: () => expectedSshHosts })
}

function expectedHost(
  targetId: string,
  connectionStatus: ExpectedSshAiVaultHost['connectionStatus']
): ExpectedSshAiVaultHost {
  return { targetId, label: targetId, connectionStatus }
}

function session(executionHostId: string, sessionId: string): AiVaultSession {
  return {
    id: `${executionHostId}:codex:${sessionId}:/transcripts/${sessionId}.jsonl`,
    agent: 'codex',
    sessionId,
    filePath: `/transcripts/${sessionId}.jsonl`,
    updatedAt: '2026-07-27T00:00:00.000Z',
    executionHostId
  } as AiVaultSession
}

function hostInfo() {
  return {
    targetId: 'dev-box',
    executionHostId: 'ssh:dev-box' as const,
    remoteHome: '/home/ada',
    hostPlatform: getRemoteHostPlatform('linux-x64')
  }
}
