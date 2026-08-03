import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PortScanCommandTimeoutError,
  runPortScanCommandInProcess
} from './port-scan-command-execution'

type ExecCallback = (
  error: (Error & { killed?: boolean; code?: string }) | null,
  stdout: string
) => void

function blockCallingThread(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    // Busy-wait: a hooked CreateProcessW holds the thread, it does not yield.
  }
}

describe('runPortScanCommandInProcess', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Regression for #11161. The watchdog used to be armed before execFile, so
  // time libuv spent inside CreateProcessW was charged to the command and a
  // healthy command was reported as a timeout.
  it('does not report a timeout when only process creation was delayed', async () => {
    const execFileMock = vi.fn((_c: string, _a: string[], _o: unknown, callback: unknown) => {
      blockCallingThread(4_200)
      setTimeout(() => (callback as ExecCallback)(null, 'ok'), 5)
      return { kill: vi.fn() }
    })

    const result = await runPortScanCommandInProcess('lsof', [], execFileMock as never)

    expect(result.stdout).toBe('ok')
    expect(result.spawnMs).toBeGreaterThanOrEqual(4_000)
  })

  it('kills the child and times out when the callback never arrives', async () => {
    vi.useFakeTimers()
    const kill = vi.fn()
    const execFileMock = vi.fn(() => ({ kill }))

    const promise = runPortScanCommandInProcess('lsof', [], execFileMock as never)
    const assertion = expect(promise).rejects.toBeInstanceOf(PortScanCommandTimeoutError)
    await vi.advanceTimersByTimeAsync(4_000)

    await assertion
    expect(kill).toHaveBeenCalled()
  })

  // Without this, moving the manual watchdog after the spawn would leave the
  // scanner's backoff unreachable: Node's own timeout kill would surface as a
  // plain error and never be classified as a timeout.
  it("classifies Node's own execFile timeout kill as a command timeout", async () => {
    const execFileMock = vi.fn((_c: string, _a: string[], _o: unknown, callback: unknown) => {
      const error = Object.assign(new Error('killed'), { killed: true })
      setTimeout(() => (callback as ExecCallback)(error, ''), 1)
      return { kill: vi.fn() }
    })

    await expect(
      runPortScanCommandInProcess('lsof', [], execFileMock as never)
    ).rejects.toBeInstanceOf(PortScanCommandTimeoutError)
  })

  it('does not treat a maxBuffer overflow kill as a command timeout', async () => {
    const execFileMock = vi.fn((_c: string, _a: string[], _o: unknown, callback: unknown) => {
      const error = Object.assign(new Error('stdout maxBuffer exceeded'), {
        killed: true,
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      })
      setTimeout(() => (callback as ExecCallback)(error, ''), 1)
      return { kill: vi.fn() }
    })

    await expect(
      runPortScanCommandInProcess('netstat', [], execFileMock as never)
    ).rejects.not.toBeInstanceOf(PortScanCommandTimeoutError)
  })

  it('leaves a genuine command failure unclassified so the scan does not back off', async () => {
    const execFileMock = vi.fn((_c: string, _a: string[], _o: unknown, callback: unknown) => {
      setTimeout(() => (callback as ExecCallback)(new Error('ENOENT'), ''), 1)
      return { kill: vi.fn() }
    })

    await expect(
      runPortScanCommandInProcess('lsof', [], execFileMock as never)
    ).rejects.not.toBeInstanceOf(PortScanCommandTimeoutError)
  })
})
