import { execFile, spawn, type ChildProcess } from 'node:child_process'

const POSIX_TREE_KILL_GRACE_MS = 1_000

function hasRelaySubprocessExited(child: ChildProcess): boolean {
  return child.exitCode !== undefined
    ? child.exitCode !== null
    : child.signalCode !== undefined && child.signalCode !== null
}

// Why: Windows commands may run through wrappers, so killing only the direct
// child can leave Git or an agent alive after cancellation.
export function terminateRelaySubprocessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) {
    return
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
      // Best-effort; the child close listener owns completion.
    })
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Child may already have exited between the kill request and now.
  }
}

export function terminateRelaySubprocessTreeAndWait(
  child: ChildProcess,
  leaderAlreadyClosed = false
): Promise<void> {
  const pid = child.pid
  if (!pid) {
    return new Promise(() => {})
  }
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      let childClosed = leaderAlreadyClosed || hasRelaySubprocessExited(child)
      let treeKilled = false
      const finish = (): void => {
        if (childClosed && treeKilled) {
          resolve()
        }
      }
      child.once('close', () => {
        childClosed = true
        finish()
      })
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.once('close', (code) => {
        treeKilled = code === 0
        finish()
      })
      killer.once('error', () => {
        // An unconfirmed tree remains owned until the relay exits.
      })
    })
  }
  return new Promise((resolve) => {
    let leaderClosed = leaderAlreadyClosed || hasRelaySubprocessExited(child)
    let settled = false
    let forceTimer: NodeJS.Timeout | null = null
    const groupGone = (): boolean => {
      try {
        process.kill(-pid, 0)
        return false
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH'
      }
    }
    const finish = (): boolean => {
      if (leaderClosed && groupGone()) {
        settled = true
        if (forceTimer) {
          clearTimeout(forceTimer)
        }
        resolve()
        return true
      }
      return false
    }
    const poll = (): void => {
      if (settled || finish()) {
        return
      }
      setTimeout(poll, 25).unref()
    }
    child.once('close', () => {
      leaderClosed = true
      finish()
    })
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // The final group probe decides whether the resource has settled.
    }
    forceTimer = setTimeout(() => {
      if (finish()) {
        return
      }
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // The final group probe decides whether the resource has settled.
      }
      poll()
    }, POSIX_TREE_KILL_GRACE_MS)
    forceTimer.unref()
  })
}

export function settleRelaySubprocessTreeAfterExit(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid || process.platform === 'win32') {
    return Promise.resolve()
  }
  try {
    process.kill(-pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return Promise.resolve()
    }
  }
  return terminateRelaySubprocessTreeAndWait(child, true)
}
