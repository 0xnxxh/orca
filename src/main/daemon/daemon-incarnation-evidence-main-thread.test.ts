import type * as ChildProcessModule from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { ExactDaemonIncarnation } from './daemon-incarnation-evidence-types'

const { execFileMock, execFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout: `${new Date(1_700_000_000_000).toString()}\n`, stderr: '' })
    }
  ),
  execFileSyncMock: vi.fn(() => '')
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  execFile: execFileMock,
  execFileSync: execFileSyncMock
}))

const { probeDaemonProcessIdentity } = await import('./daemon-incarnation-evidence')

const endpoint = { socketPath: '/runtime/daemon.sock', tokenPath: '/runtime/daemon.token' }
const exactIncarnation: ExactDaemonIncarnation = {
  identity: { pid: 42, startedAtMs: 1_700_000_000_000, launchNonce: 'launch-a' }
}

describe('daemon audit evidence main-thread cost', () => {
  it('reads the macOS process start time without a synchronous main-thread spawn', async () => {
    await expect(
      probeDaemonProcessIdentity(exactIncarnation, endpoint, {
        platform: 'darwin',
        signalProcess: () => 'occupied',
        readCommandLine: async () =>
          `node daemon-entry --socket ${endpoint.socketPath} --token ${endpoint.tokenPath}`
      })
    ).resolves.toMatchObject({ state: 'present', reason: 'macos_identity_match' })

    expect(execFileSyncMock).not.toHaveBeenCalled()
    expect(execFileMock).toHaveBeenCalledWith(
      'ps',
      ['-p', '42', '-o', 'lstart='],
      expect.anything(),
      expect.any(Function)
    )
  })
})
