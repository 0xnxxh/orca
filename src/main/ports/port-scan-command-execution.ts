import { execFile, type ExecFileException } from 'node:child_process'
import {
  PORT_SCAN_COMMAND_TIMEOUT_MS,
  PORT_SCAN_MAX_BUFFER_BYTES
} from './port-scan-command-protocol'

// Why (#11161): this is the only place that spawns a port-scan command, and it
// is meant to run on a worker thread. libuv performs process creation inline on
// the calling loop, so hosting it on the main process' loop is what froze the
// UI when an endpoint-security module hooked CreateProcessW.

export class PortScanCommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`${command} timed out after ${timeoutMs}ms`)
    this.name = 'PortScanCommandTimeoutError'
  }
}

export type PortScanCommandResult = {
  stdout: string
  // How long the execFile call itself held the calling thread. On a healthy
  // host this is single-digit ms; a hooked CreateProcessW pushes it to seconds.
  spawnMs: number
}

type ExecFileImpl = typeof execFile

// Node kills the child itself when `options.timeout` elapses, surfacing as an
// error carrying the kill. That must still be classified as a command timeout,
// otherwise moving the manual watchdog after the spawn (below) would leave the
// scanner's backoff unreachable. maxBuffer overflow also kills the child, so it
// is excluded — that is a command that produced too much output, not a hang.
function isTimeoutKill(error: ExecFileException): boolean {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return false
  }
  return error.killed === true
}

/**
 * Run one port-scan command and capture stdout.
 * @param command - Binary to execute (never a shell).
 * @param args - Argument vector, passed through untouched.
 * @param execFileImpl - Seam for tests.
 * @returns stdout plus the synchronous cost of creating the process.
 * @throws PortScanCommandTimeoutError when the command itself overruns its
 *   budget; other spawn/exec failures reject with the underlying error.
 */
export async function runPortScanCommandInProcess(
  command: string,
  args: readonly string[],
  execFileImpl: ExecFileImpl = execFile
): Promise<PortScanCommandResult> {
  const spawnStartedAt = Date.now()
  let spawnReturnedAt: number | null = null
  // A synchronous callback (only reachable from a test double) has no spawn
  // return to measure against, so fall back to elapsed time at settle.
  const spawnMs = (): number => (spawnReturnedAt ?? Date.now()) - spawnStartedAt

  return await new Promise<PortScanCommandResult>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    let child: ReturnType<ExecFileImpl> | undefined

    const settle = (run: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      run()
    }

    try {
      child = execFileImpl(
        command,
        args as string[],
        {
          timeout: PORT_SCAN_COMMAND_TIMEOUT_MS,
          maxBuffer: PORT_SCAN_MAX_BUFFER_BYTES,
          windowsHide: true
        },
        (error, stdout) => {
          if (error) {
            settle(() =>
              reject(
                isTimeoutKill(error)
                  ? new PortScanCommandTimeoutError(command, PORT_SCAN_COMMAND_TIMEOUT_MS)
                  : error
              )
            )
            return
          }
          settle(() => resolve({ stdout: String(stdout), spawnMs: spawnMs() }))
        }
      )
    } catch (error) {
      settle(() => reject(error))
      return
    }

    spawnReturnedAt = Date.now()
    // Why (#11161): arm the watchdog only once execFile has returned. Armed
    // before the call, it also counted the time libuv spent inside
    // CreateProcessW, so a delayed spawn was misreported as a command timeout
    // and tripped the scanner's 60s-5min backoff for a command that never ran.
    // Node's own options.timeout is the primary killer; this covers the case
    // where the callback never arrives at all.
    if (!settled) {
      timer = setTimeout(() => {
        settle(() => {
          child?.kill()
          reject(new PortScanCommandTimeoutError(command, PORT_SCAN_COMMAND_TIMEOUT_MS))
        })
      }, PORT_SCAN_COMMAND_TIMEOUT_MS)
      timer.unref?.()
    }
  })
}
