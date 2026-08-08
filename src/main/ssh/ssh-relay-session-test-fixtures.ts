import { vi, type Mock } from 'vitest'
import type { BrowserWindow } from 'electron'
import { PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR } from '../../shared/pty-consumer-session'
import type { SshConnection } from './ssh-connection'
import type { Store } from '../persistence'
import type { SshPortForwardManager } from './ssh-port-forward'
import { deployAndLaunchRelay, type RelayDeployResult } from './ssh-relay-deploy'

type SshRelaySessionTestDeps = {
  mockConn: SshConnection
  mockStore: Store
  mockPortForward: SshPortForwardManager
  getMainWindow: Mock<() => BrowserWindow | null>
  mockWindow: BrowserWindow
}

export function createMockDeps(): SshRelaySessionTestDeps {
  const mockConn = {} as SshConnection
  const mockStore = {
    getRepos: vi.fn().mockReturnValue([]),
    getSshPtyConsumerRecovery: vi.fn().mockReturnValue(null),
    upsertSshPtyConsumerRecovery: vi.fn(),
    removeSshPtyConsumerRecovery: vi.fn(),
    getSshRemotePtyLeases: vi.fn().mockReturnValue([]),
    markSshRemotePtyLease: vi.fn(),
    markSshRemotePtyLeases: vi.fn(),
    markSshRemotePtyLeasesAsync: vi.fn(),
    markSshRemotePtyLeasesForShutdown: vi.fn(),
    markSshRemotePtyLeasesAttachedAsync: vi.fn(),
    persistPtyBinding: vi.fn()
  } as unknown as Store
  const mockPortForward = {
    removeAllForwards: vi.fn()
  } as unknown as SshPortForwardManager
  const mockWindow = {
    isDestroyed: () => false,
    // Why: the port scanner visibility-gates its ticks; a visible mock window
    // keeps establish-path tests exercising the scan-on-ready behavior.
    isVisible: () => true,
    isMinimized: () => false,
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow
  const getMainWindow = vi.fn().mockReturnValue(mockWindow)
  return { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow }
}

export function mockDeploySuccess(): RelayDeployResult {
  const result: RelayDeployResult = {
    transport: {
      write: vi.fn(),
      onData: vi.fn(),
      onClose: vi.fn()
    },
    authorityHostId: 'test-authority-host',
    terminalAuthorityOwnerBuildId: 'test-authority-build',
    priorRelayStatus: { kind: 'none' as const },
    terminalAuthorityOwnerRelayDir: '/test/authority-relay',
    platform: 'linux-x64'
  }
  vi.mocked(deployAndLaunchRelay).mockResolvedValue(result)
  return result
}

export function createMismatchedOwnerRecoveryError(): unknown {
  return Object.assign(new Error('Owner recovery lease is stale'), {
    code: PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR
  })
}

export function legacyFallbackSession(clientInstanceId: string) {
  return {
    state: {
      mode: 'legacy-fallback' as const,
      clientInstanceId,
      serverBuildId: 'test-relay-build'
    },
    resumed: false
  }
}
