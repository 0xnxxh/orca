import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { win32 as pathWin32 } from 'node:path'

export const WINDOWS_DESCENDANT_KILL_TIMEOUT_MS = 2_000
export const WINDOWS_PTY_JOB_DRAIN_TIMEOUT_MS = 8_000

type WindowsTreeKillProcess = Pick<ChildProcess, 'kill' | 'once' | 'unref'>

export type WindowsTreeKillSpawner = (
  file: string,
  args: string[],
  options: SpawnOptions
) => WindowsTreeKillProcess

type WindowsTreeKillDeps = {
  spawn?: WindowsTreeKillSpawner
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

/**
 * Best-effort fallback for Windows hosts where node-pty could not assign the
 * shell to a Job Object. taskkill follows only live PPID links, so it cannot
 * reach a detached child whose launcher already exited. It also accepts only
 * a PID, leaving a small reuse window after node-pty closes the shell handle.
 */
export function requestWindowsDescendantTreeTermination(
  rootPid: number,
  deps: WindowsTreeKillDeps = {}
): Promise<void> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return Promise.reject(new Error(`Invalid Windows PTY root PID: ${rootPid}`))
  }

  const systemRoot = (deps.env ?? process.env).SystemRoot
  const taskkillPath = systemRoot
    ? pathWin32.join(systemRoot, 'System32', 'taskkill.exe')
    : 'taskkill'
  const spawnProcess: WindowsTreeKillSpawner = deps.spawn ?? spawn

  return new Promise((resolve, reject) => {
    let settled = false
    let child: WindowsTreeKillProcess | undefined
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timer = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        /* taskkill may have exited between the deadline and cancellation */
      }
      finish(new Error(`taskkill timed out for Windows PTY root ${rootPid}`))
    }, deps.timeoutMs ?? WINDOWS_DESCENDANT_KILL_TIMEOUT_MS)
    timer.unref?.()

    try {
      child = spawnProcess(taskkillPath, ['/PID', String(rootPid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true
      })
      child.once('error', (error) =>
        finish(new Error(`taskkill failed for Windows PTY root ${rootPid}: ${error.message}`))
      )
      child.once('exit', (code) =>
        finish(
          code === 0
            ? undefined
            : new Error(
                `taskkill exited ${code ?? 'without a code'} for Windows PTY root ${rootPid}`
              )
        )
      )
      child.unref()
    } catch {
      finish(new Error(`Could not start taskkill for Windows PTY root ${rootPid}`))
    }
  })
}
