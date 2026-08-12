#!/usr/bin/env node
/**
 * Process-table helpers for the daemon PTY preservation repro: what is alive, what a pid is
 * running, and which daemons were already here before the run. Split out so the repro script
 * itself stays about the sequence it proves rather than the plumbing it proves it with.
 */
import { execFileSync } from 'node:child_process'

const REAL_USER_DAEMON_MARKER = 'Library/Application Support/orca/daemon'

export function processArgs(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 5_000
    }).trim()
  } catch {
    return null
  }
}

export function processState(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'stat='], {
      encoding: 'utf8',
      timeout: 5_000
    }).trim()
  } catch {
    return null
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

// Why scan by tag rather than trust the session pid: macOS wraps the PTY in
// /usr/bin/login for TCC attribution, so the agent process is a descendant of
// the session leader — exactly as a real `claude`/`codex` launch would be.
export function findTaggedPid(tag) {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      timeout: 5_000
    })
    for (const line of output.split('\n')) {
      if (line.includes(tag)) {
        const pid = Number(line.trim().split(/\s+/, 1)[0])
        if (Number.isInteger(pid) && pid > 0) {
          return pid
        }
      }
    }
  } catch {
    // ps failed; treat as not found.
  }
  return null
}

export function isMarkerAlive(marker) {
  return processArgs(marker.pid)?.includes(marker.tag) === true
}

// Pre-existing daemons (the user's real one above all) must be untouched by this run.
export function snapshotForeignDaemons() {
  const daemons = []
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 5_000 })
    for (const line of output.split('\n')) {
      if (!line.includes('daemon-entry.js')) {
        continue
      }
      const pid = Number(line.trim().split(/\s+/, 1)[0])
      if (Number.isInteger(pid) && pid > 0) {
        daemons.push({ pid, isRealUserDaemon: line.includes(REAL_USER_DAEMON_MARKER) })
      }
    }
  } catch {
    // ps failed; the exit check will report an empty snapshot.
  }
  return daemons
}

export async function waitFor(predicate, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}
