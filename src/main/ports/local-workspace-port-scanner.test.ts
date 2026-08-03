import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import {
  attributePortToWorkspace,
  isContainerProcess,
  parseLsofListeningOutput,
  parseNetstatListeningOutput,
  parseProcNetTcp,
  resetWorkspacePortScanTimeoutBackoffForTests,
  scanWorkspacePorts
} from './local-workspace-port-scanner'
import { PortScanCommandTimeout } from './port-scan-command-client'

const runPortScanCommandMock = vi.hoisted(() => vi.fn())

vi.mock('./port-scan-command-worker-spawn', () => ({
  runPortScanCommand: runPortScanCommandMock
}))

// Healthy hosts return process creation in single-digit ms; the scanner only
// reads spawnMs to decide whether to skip optional metadata commands.
const FAST_SPAWN_MS = 2

function commandOutput(
  stdout: string,
  spawnMs = FAST_SPAWN_MS
): Promise<{
  stdout: string
  spawnMs: number
}> {
  return Promise.resolve({ stdout, spawnMs })
}

const worktrees = [
  {
    id: 'repo::/repo',
    repoId: 'repo',
    displayName: 'main',
    path: '/repo'
  },
  {
    id: 'repo::/repo/worktrees/feature',
    repoId: 'repo',
    displayName: 'feature',
    path: '/repo/worktrees/feature'
  }
]

describe('local workspace port scanner parsing', () => {
  it('parses lsof field output into listening ports', () => {
    const ports = parseLsofListeningOutput(
      ['p123', 'cnode', 'n127.0.0.1:5173', 'p456', 'cnginx', 'n*:8080'].join('\n')
    )

    expect(ports).toEqual([
      { pid: 123, processName: 'node', host: '127.0.0.1', port: 5173 },
      { pid: 456, processName: 'nginx', host: '*', port: 8080 }
    ])
  })

  it('parses multiple lsof listening ports for the same process', () => {
    const ports = parseLsofListeningOutput(
      ['p123', 'cnode', 'n127.0.0.1:5173', 'n127.0.0.1:55173'].join('\n')
    )

    expect(ports).toEqual([
      { pid: 123, processName: 'node', host: '127.0.0.1', port: 5173 },
      { pid: 123, processName: 'node', host: '127.0.0.1', port: 55173 }
    ])
  })

  it('parses Windows netstat listening rows', () => {
    const ports = parseNetstatListeningOutput(
      [
        'Proto  Local Address          Foreign Address        State           PID',
        'TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       4242',
        'TCP    [::]:5173              [::]:0                 LISTENING       5151'
      ].join('\n')
    )

    expect(ports).toEqual([
      { host: '127.0.0.1', port: 3000, pid: 4242 },
      { host: '::', port: 5173, pid: 5151 }
    ])
  })

  it('parses Windows netstat rows without whitespace regex splitting', () => {
    const splitSpy = vi.spyOn(String.prototype, 'split')
    const ports = parseNetstatListeningOutput(
      'TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       4242'
    )
    const usedWhitespaceFieldSplit = splitSpy.mock.calls.some(
      ([separator]) => separator instanceof RegExp && separator.source.includes('\\s+')
    )
    splitSpy.mockRestore()

    expect(ports).toEqual([{ host: '127.0.0.1', port: 3000, pid: 4242 }])
    expect(usedWhitespaceFieldSplit).toBe(false)
  })

  it('parses Linux proc tcp listeners', () => {
    const ports = parseProcNetTcp(
      [
        '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
        '   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 12345 1 0000000000000000 100 0 0 10 0'
      ].join('\n')
    )

    expect(ports).toEqual([{ host: '127.0.0.1', port: 3000, inode: 12345 }])
  })

  it('parses Linux proc rows without whitespace regex splitting', () => {
    const splitSpy = vi.spyOn(String.prototype, 'split')
    const ports = parseProcNetTcp(
      [
        '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
        '   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 12345'
      ].join('\n')
    )
    const usedWhitespaceFieldSplit = splitSpy.mock.calls.some(
      ([separator]) => separator instanceof RegExp && separator.source.includes('\\s+')
    )
    splitSpy.mockRestore()

    expect(ports).toEqual([{ host: '127.0.0.1', port: 3000, inode: 12345 }])
    expect(usedWhitespaceFieldSplit).toBe(false)
  })
})

describe('attributePortToWorkspace', () => {
  it('uses cwd ancestry and picks the deepest matching worktree', () => {
    const owner = attributePortToWorkspace(
      { cwd: '/repo/worktrees/feature/packages/app', commandLine: 'node server.js' },
      worktrees
    )

    expect(owner).toMatchObject({
      worktreeId: 'repo::/repo/worktrees/feature',
      displayName: 'feature',
      confidence: 'cwd'
    })
  })

  it('falls back to command-line path evidence', () => {
    const commandPath = path.posix.resolve('/repo/worktrees/feature/node_modules/vite/bin/vite.js')
    const owner = attributePortToWorkspace({ commandLine: `node ${commandPath}` }, worktrees)

    expect(owner).toMatchObject({
      worktreeId: 'repo::/repo/worktrees/feature',
      confidence: 'command'
    })
  })

  it('requires command-line path boundary evidence', () => {
    const owner = attributePortToWorkspace(
      { commandLine: `node ${path.posix.resolve('/repo/worktrees/feature-other/server.js')}` },
      [worktrees[1]]
    )

    expect(owner).toBeUndefined()
  })

  it('keeps path case significant on case-sensitive platforms', () => {
    const owner = attributePortToWorkspace({ cwd: '/Repo/worktrees/feature' }, worktrees)

    if (process.platform === 'win32') {
      expect(owner).toMatchObject({ worktreeId: 'repo::/repo/worktrees/feature' })
    } else {
      expect(owner).toBeUndefined()
    }
  })

  it('does not guess when there is no worktree evidence', () => {
    const owner = attributePortToWorkspace({ cwd: '/Applications/ContainerRuntime.app' }, worktrees)

    expect(owner).toBeUndefined()
  })
})

describe('container process classification', () => {
  it('detects common container listener owners without workspace attribution', () => {
    expect(isContainerProcess({ processName: 'com.container.backend' })).toBe(true)
    expect(isContainerProcess({ processName: 'com.vendor.backend' })).toBe(true)
    expect(isContainerProcess({ commandLine: '/usr/bin/container-runtime port-forward' })).toBe(
      true
    )
    expect(isContainerProcess({ processName: 'node', commandLine: 'node server.js' })).toBe(false)
  })
})

describe('scanWorkspacePorts attribution work', () => {
  afterEach(() => {
    resetWorkspacePortScanTimeoutBackoffForTests()
    vi.restoreAllMocks()
    runPortScanCommandMock.mockReset()
  })

  it('normalizes worktree paths once per scan instead of once per port phase', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const win32ResolveSpy = vi.spyOn(path.win32, 'resolve')
    const posixResolveSpy = vi.spyOn(path.posix, 'resolve')
    runPortScanCommandMock.mockImplementation((command: string, args: readonly string[]) => {
      if (command === 'lsof' && args.includes('-iTCP')) {
        return commandOutput(
          ['p123', 'cnode', 'n127.0.0.1:3000', 'p124', 'cnode', 'n127.0.0.1:3001'].join('\n')
        )
      }
      if (command === 'lsof') {
        return commandOutput(
          ['p123', 'n/repo/service', 'p124', 'n/repo/worktrees/feature/app'].join('\n')
        )
      }
      if (command === 'ps') {
        return commandOutput(
          [
            '123 node /repo/service/server.js',
            '124 node /repo/worktrees/feature/app/server.js'
          ].join('\n')
        )
      }
      return commandOutput('')
    })

    const scan = await scanWorkspacePorts(worktrees, {
      lookup: () => undefined,
      reconcileScan: vi.fn()
    })

    expect(scan.ports.filter((port) => port.kind === 'workspace')).toHaveLength(2)
    const win32WorktreePathResolveCalls = win32ResolveSpy.mock.calls.filter(
      ([input]) => input === '/repo' || input === '/repo/worktrees/feature'
    )
    const posixWorktreePathResolveCalls = posixResolveSpy.mock.calls.filter(
      ([input]) => input === '/repo' || input === '/repo/worktrees/feature'
    )
    expect(win32WorktreePathResolveCalls).toHaveLength(0)
    expect(posixWorktreePathResolveCalls).toHaveLength(worktrees.length)
  })
})

describe('scanWorkspacePorts command timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetWorkspacePortScanTimeoutBackoffForTests()
    vi.restoreAllMocks()
    runPortScanCommandMock.mockReset()
  })

  // The worker owns the command deadline now, so it is what rejects.
  const workerTimeout = (): Promise<never> =>
    Promise.reject(new PortScanCommandTimeout('lsof timed out after 4000ms'))

  it('returns an unavailable scan when lsof never reports completion', async () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    runPortScanCommandMock.mockImplementation(workerTimeout)

    let settled = false
    const scanPromise = scanWorkspacePorts([], {
      lookup: () => undefined,
      reconcileScan: vi.fn()
    }).then((scan) => {
      settled = true
      return scan
    })

    await vi.advanceTimersByTimeAsync(4_000)

    expect(settled).toBe(true)
    await expect(scanPromise).resolves.toMatchObject({
      platform: 'darwin',
      ports: [],
      unavailableReason: 'Port scanning is unavailable on darwin.'
    })
  })

  it('backs off after a command timeout instead of launching lsof on every scan tick', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    runPortScanCommandMock.mockImplementation(workerTimeout)

    const firstScanPromise = scanWorkspacePorts([], {
      lookup: () => undefined,
      reconcileScan: vi.fn()
    })

    await vi.advanceTimersByTimeAsync(4_000)
    await expect(firstScanPromise).resolves.toMatchObject({
      platform: 'darwin',
      ports: [],
      unavailableReason: 'Port scanning is unavailable on darwin.'
    })
    expect(runPortScanCommandMock).toHaveBeenCalledTimes(1)

    const cooldownScans = await Promise.all(
      Array.from({ length: 10 }, () =>
        scanWorkspacePorts([], {
          lookup: () => undefined,
          reconcileScan: vi.fn()
        })
      )
    )

    expect(cooldownScans).toHaveLength(10)
    expect(cooldownScans[0]).toMatchObject({
      platform: 'darwin',
      ports: []
    })
    expect(
      cooldownScans.every((scan) => scan.unavailableReason?.includes('temporarily paused'))
    ).toBe(true)
    expect(runPortScanCommandMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(65_001)
    await vi.advanceTimersByTimeAsync(0)
    runPortScanCommandMock.mockImplementation((_command: string, args: readonly string[]) =>
      commandOutput(args.includes('-iTCP') ? 'p123\ncnode\nn127.0.0.1:3000' : '')
    )

    const recoveredScan = await scanWorkspacePorts([], {
      lookup: () => undefined,
      reconcileScan: vi.fn()
    })

    expect(recoveredScan.unavailableReason).toBeUndefined()
    expect(runPortScanCommandMock).toHaveBeenCalledTimes(4)
  })
})

describe('scanWorkspacePorts with delayed process creation', () => {
  afterEach(() => {
    resetWorkspacePortScanTimeoutBackoffForTests()
    vi.restoreAllMocks()
    runPortScanCommandMock.mockReset()
  })

  // Regression for #11161: an endpoint-security hook on CreateProcessW delays
  // the spawn, not the command. That must not read as a command timeout.
  it('does not report a command timeout when only process creation was delayed', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    runPortScanCommandMock.mockImplementation(() =>
      commandOutput('p123\ncnode\nn127.0.0.1:3000', 4_200)
    )

    const scan = await scanWorkspacePorts([], { lookup: () => undefined, reconcileScan: vi.fn() })

    expect(scan.unavailableReason).toBeUndefined()
    expect(scan.ports).toHaveLength(1)
  })

  it('skips the optional metadata commands for one cycle after a stalled spawn', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    runPortScanCommandMock.mockImplementation(() =>
      commandOutput('p123\ncnode\nn127.0.0.1:3000', 4_200)
    )

    await scanWorkspacePorts([], { lookup: () => undefined, reconcileScan: vi.fn() })

    // Only the primary probe; lsof -d cwd and ps are not issued this cycle.
    expect(runPortScanCommandMock).toHaveBeenCalledTimes(1)
  })

  it('still collects process metadata when process creation was fast', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    runPortScanCommandMock.mockImplementation((command: string, args: readonly string[]) => {
      if (command === 'lsof' && args.includes('-iTCP')) {
        return commandOutput('p123\ncnode\nn127.0.0.1:3000')
      }
      return commandOutput('')
    })

    await scanWorkspacePorts([], { lookup: () => undefined, reconcileScan: vi.fn() })

    expect(runPortScanCommandMock).toHaveBeenCalledTimes(3)
  })
})
