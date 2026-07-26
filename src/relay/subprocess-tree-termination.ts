import { execFile, spawn, type ChildProcess } from 'node:child_process'

const POSIX_TREE_KILL_GRACE_MS = 1_000

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

export function terminateRelaySubprocessTreeAndWait(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid) {
    return new Promise(() => {})
  }
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      let childClosed = false
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
    let leaderClosed = false
    let forced = false
    const groupGone = (): boolean => {
      try {
        process.kill(-pid, 0)
        return false
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH'
      }
    }
    const finish = (): void => {
      if (leaderClosed && forced && groupGone()) {
        resolve()
        return
      }
      setTimeout(finish, 25).unref()
    }
    child.once('close', () => {
      leaderClosed = true
    })
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // The final group probe decides whether the resource has settled.
    }
    const forceTimer = setTimeout(() => {
      forced = true
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // The final group probe decides whether the resource has settled.
      }
      finish()
    }, POSIX_TREE_KILL_GRACE_MS)
    forceTimer.unref()
  })
}
