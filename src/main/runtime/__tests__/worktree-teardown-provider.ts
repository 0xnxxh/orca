import { vi } from 'vitest'
import type { IPtyProvider, PtyProcessInfo } from '../../providers/types'

export type WorktreeTeardownProviderStub = IPtyProvider & {
  shutdown: ReturnType<typeof vi.fn>
  listProcesses: ReturnType<typeof vi.fn>
  killExact: ReturnType<typeof vi.fn>
  killAuthorityExact: ReturnType<typeof vi.fn>
  getPtyMutationRouteToken: ReturnType<typeof vi.fn>
  setMutationRouteToken: (token: object | null) => void
}

export function createWorktreeTeardownProviderStub(
  listProcesses: () => Promise<PtyProcessInfo[]>
): WorktreeTeardownProviderStub {
  let mutationRouteToken: object | null = Object.freeze({})
  const provider = {
    spawn: vi.fn(),
    attach: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    sendSignal: vi.fn(),
    getCwd: vi.fn(),
    getInitialCwd: vi.fn(),
    clearBuffer: vi.fn(),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(),
    getForegroundProcess: vi.fn(),
    serialize: vi.fn(),
    revive: vi.fn(),
    listProcesses: vi.fn(async () => {
      const listedToken = mutationRouteToken
      return (await listProcesses()).map((session) => ({
        ...session,
        incarnationId: session.incarnationId ?? `incarnation:${session.id}`,
        ...(listedToken ? { mutationRouteToken: listedToken } : {})
      }))
    }),
    getDefaultShell: vi.fn(),
    getProfiles: vi.fn(),
    onData: vi.fn().mockReturnValue(() => {}),
    onReplay: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn().mockReturnValue(() => {}),
    killExact: vi.fn(),
    killAuthorityExact: vi.fn(),
    getPtyMutationRouteToken: vi.fn(() => mutationRouteToken),
    setMutationRouteToken: (token: object | null) => {
      mutationRouteToken = token
    }
  }
  provider.killExact.mockImplementation(
    async (id: string, _incarnationId: string, opts: { immediate?: boolean }) => {
      await provider.shutdown(id, opts)
      return true
    }
  )
  provider.killAuthorityExact.mockImplementation(
    async (id: string, _access: unknown, opts: { immediate?: boolean }) => {
      await provider.shutdown(id, opts)
      return true
    }
  )
  return provider as unknown as WorktreeTeardownProviderStub
}
