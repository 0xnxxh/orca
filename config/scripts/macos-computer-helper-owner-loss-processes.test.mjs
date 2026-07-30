import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  killProcessMatchingCommand,
  killRecordedAndMatchingProcesses,
  killRecordedProcess,
  processIdentity,
  signalProcessIdentity,
  signalValidatedProcessGroup,
  spawnBenchmarkProcess,
  writeProcessRecord
} from './macos-computer-helper-owner-loss-processes.mjs'

const describeMacOS = process.platform === 'darwin' ? describe : describe.skip
const spawnedPids = new Set()
const temporaryDirectories = new Set()

afterEach(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  spawnedPids.clear()
  for (const temporaryDirectory of temporaryDirectories) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

describeMacOS('macOS helper owner-loss benchmark process cleanup', () => {
  it('enforces a hard timeout when the trial ignores SIGTERM', () => {
    const startedAt = Date.now()
    const result = spawnBenchmarkProcess(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)"],
      { stdio: 'ignore', timeout: 100 }
    )
    expect(result.error?.code).toBe('ETIMEDOUT')
    expect(result.signal).toBe('SIGKILL')
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(() => process.kill(result.pid, 0)).toThrow()
  })

  it('kills a timed-out trial group only after validating its environment', async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'orca-owner-benchmark-group-test-'))
    temporaryDirectories.add(temporaryDirectory)
    const childPidPath = path.join(temporaryDirectory, 'child.pid')
    const environmentName = `ORCA_OWNER_GROUP_${process.pid}`
    const environmentValue = `${Date.now()}`
    const fixture = `
      const { spawn } = require('node:child_process')
      const { writeFileSync } = require('node:fs')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore'
      })
      writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid))
      setInterval(() => {}, 1000)
    `
    const result = spawnBenchmarkProcess(process.execPath, ['-e', fixture], {
      env: { ...process.env, [environmentName]: environmentValue },
      stdio: 'ignore',
      timeout: 100
    })
    const childPid = Number(readFileSync(childPidPath, 'utf8'))
    spawnedPids.add(childPid)
    const environmentFragment = `${environmentName}=${environmentValue}`

    expect(() =>
      signalValidatedProcessGroup(result.pid, `${environmentName}=wrong`, 'SIGSTOP')
    ).toThrow('Benchmark process group no longer belongs to this trial')
    expect(() => process.kill(childPid, 0)).not.toThrow()
    expect(signalValidatedProcessGroup(result.pid, environmentFragment, 'SIGSTOP')).toBe(true)
    expect(signalValidatedProcessGroup(result.pid, environmentFragment, 'SIGKILL')).toBe(true)
    await expect
      .poll(() => {
        try {
          process.kill(childPid, 0)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)

    spawnedPids.delete(childPid)
  })

  it('resumes marked group members after revalidation fails', () => {
    const marker = 'ORCA_OWNER_GROUP=trial'
    const members = [
      { pid: 41, pgid: 41, command: `/launcher ${marker}` },
      { pid: 42, pgid: 41, command: `/child ${marker}` }
    ]
    const signals = []
    let scanCount = 0

    expect(() =>
      signalValidatedProcessGroup(41, marker, 'SIGKILL', {
        processIdentities: () => {
          scanCount += 1
          if (scanCount === 3) {
            throw new Error('transient group inspection failure')
          }
          return members
        },
        signalProcess: (pid, signal) => {
          signals.push([pid, signal])
        }
      })
    ).toThrow('transient group inspection failure')
    expect(signals).toEqual([
      [41, 'SIGSTOP'],
      [-41, 'SIGSTOP'],
      [41, 'SIGCONT'],
      [42, 'SIGCONT']
    ])
  })

  it('does not signal a replacement group anchor', () => {
    const marker = 'ORCA_OWNER_GROUP=trial'
    const anchor = { pid: 41, pgid: 41, command: `/launcher ${marker}` }
    const replacement = { pid: 41, pgid: 41, command: '/unrelated' }
    const signals = []
    let scanCount = 0

    expect(() =>
      signalValidatedProcessGroup(41, marker, 'SIGKILL', {
        processIdentities: () => {
          scanCount += 1
          return scanCount === 1 ? [anchor] : [replacement]
        },
        signalProcess: (pid, signal) => {
          signals.push([pid, signal])
        }
      })
    ).toThrow('Benchmark process group anchor changed before signaling')
    expect(signals).toEqual([[41, 'SIGSTOP']])
  })

  it('kills a recorded helper in a separate process group', async () => {
    const temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), 'orca-owner-benchmark-cleanup-test-')
    )
    temporaryDirectories.add(temporaryDirectory)
    const recordPath = path.join(temporaryDirectory, 'helper.json')
    const marker = `orca-owner-cleanup-${process.pid}-${Date.now()}`
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', marker], {
      detached: true,
      stdio: 'ignore'
    })
    spawnedPids.add(helper.pid)
    helper.unref()
    const exited = new Promise((resolve) => helper.once('exit', resolve))
    const command = execFileSync('ps', ['-p', String(helper.pid), '-o', 'command='], {
      encoding: 'utf8'
    }).trim()
    const processGroup = Number(
      execFileSync('ps', ['-p', String(helper.pid), '-o', 'pgid='], {
        encoding: 'utf8'
      }).trim()
    )
    writeProcessRecord(recordPath, { pid: helper.pid, pgid: processGroup, command })

    expect(processGroup).toBe(helper.pid)
    expect(killRecordedProcess(recordPath, marker)).toBe(true)
    await exited
    expect(() => process.kill(helper.pid, 0)).toThrow()

    spawnedPids.delete(helper.pid)
  })

  it('kills every unrecorded helper using its unique trial command', async () => {
    const marker = `orca-owner-unrecorded-${process.pid}-${Date.now()}`
    const helpers = Array.from({ length: 2 }, () =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', marker], {
        detached: true,
        stdio: 'ignore'
      })
    )
    for (const helper of helpers) {
      spawnedPids.add(helper.pid)
      helper.unref()
    }
    const exited = Promise.all(
      helpers.map((helper) => new Promise((resolve) => helper.once('exit', resolve)))
    )

    expect(killProcessMatchingCommand([process.execPath, marker])).toBe(true)
    await exited
    for (const helper of helpers) {
      expect(() => process.kill(helper.pid, 0)).toThrow()
      spawnedPids.delete(helper.pid)
    }
  })

  it('continues exact-match cleanup after an earlier match fails', () => {
    const marker = `orca-owner-multiple-${process.pid}-${Date.now()}`
    const matches = [
      { pid: 41, pgid: 41, command: `/helper ${marker}` },
      { pid: 42, pgid: 42, command: `/helper ${marker}` }
    ]
    const attempted = []
    let scanCount = 0

    expect(() =>
      killProcessMatchingCommand(['/helper', marker], {
        processIdentities: () => {
          scanCount += 1
          return scanCount === 1 ? matches : [matches[0]]
        },
        signalProcessIdentity: (identity) => {
          attempted.push(identity.pid)
          if (identity.pid === matches[0].pid) {
            throw new Error('identity changed')
          }
          return true
        },
        waitForIdentityExit: () => {}
      })
    ).toThrow('Benchmark exact-command cleanup failed')
    expect(attempted).toEqual([41, 42])
  })

  it('does not treat an identity query failure as process exit', () => {
    const queryError = new Error('transient ps failure')

    expect(() =>
      processIdentity(41, {
        executePs: () => {
          throw queryError
        },
        signalProcess: () => {}
      })
    ).toThrow(queryError)
  })

  it('resumes a helper when post-stop identity inspection fails', () => {
    const identity = { pid: 41, pgid: 41, command: '/helper marker' }
    const signals = []
    let inspectionCount = 0

    expect(() =>
      signalProcessIdentity(identity, 'marker', 'SIGKILL', {
        processIdentity: () => {
          inspectionCount += 1
          if (inspectionCount === 2) {
            throw new Error('transient ps failure after stop')
          }
          return identity
        },
        signalProcess: (pid, signal) => {
          signals.push([pid, signal])
        }
      })
    ).toThrow('transient ps failure after stop')
    expect(signals).toEqual([
      [41, 'SIGSTOP'],
      [41, 'SIGCONT']
    ])
  })

  it('does not signal a replacement PID after post-stop revalidation', () => {
    const identity = { pid: 41, pgid: 41, command: '/helper marker' }
    const replacement = { pid: 41, pgid: 41, command: '/unrelated' }
    const signals = []
    let inspectionCount = 0

    expect(() =>
      signalProcessIdentity(identity, 'marker', 'SIGKILL', {
        processIdentity: () => {
          inspectionCount += 1
          return inspectionCount === 1 ? identity : replacement
        },
        signalProcess: (pid, signal) => {
          signals.push([pid, signal])
        }
      })
    ).toThrow('Recorded benchmark helper PID changed before signaling')
    expect(signals).toEqual([[41, 'SIGSTOP']])
  })

  it('treats a missing PID as process exit after an identity query failure', () => {
    const missingProcessError = Object.assign(new Error('missing process'), { code: 'ESRCH' })

    expect(
      processIdentity(41, {
        executePs: () => {
          throw new Error('ps found no process')
        },
        signalProcess: () => {
          throw missingProcessError
        }
      })
    ).toBeNull()
  })

  it('runs unique-command cleanup after an invalid process record', async () => {
    const temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), 'orca-owner-benchmark-fallback-test-')
    )
    temporaryDirectories.add(temporaryDirectory)
    const recordPath = path.join(temporaryDirectory, 'helper.json')
    const marker = `orca-owner-invalid-record-${process.pid}-${Date.now()}`
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', marker], {
      detached: true,
      stdio: 'ignore'
    })
    spawnedPids.add(helper.pid)
    helper.unref()
    const exited = new Promise((resolve) => helper.once('exit', resolve))
    const command = execFileSync('ps', ['-p', String(helper.pid), '-o', 'command='], {
      encoding: 'utf8'
    }).trim()
    writeProcessRecord(recordPath, { pid: helper.pid, pgid: helper.pid - 1, command })

    expect(() =>
      killRecordedAndMatchingProcesses(recordPath, marker, [process.execPath, marker])
    ).toThrow('Recorded benchmark helper identity is invalid')
    await exited
    expect(() => process.kill(helper.pid, 0)).toThrow()

    spawnedPids.delete(helper.pid)
  })

  it('rejects a record that is not a detached process-group identity', () => {
    const temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), 'orca-owner-benchmark-identity-test-')
    )
    temporaryDirectories.add(temporaryDirectory)
    const recordPath = path.join(temporaryDirectory, 'helper.json')
    const marker = `orca-owner-invalid-identity-${process.pid}-${Date.now()}`
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', marker], {
      stdio: 'ignore'
    })
    spawnedPids.add(helper.pid)
    helper.unref()
    const command = execFileSync('ps', ['-p', String(helper.pid), '-o', 'command='], {
      encoding: 'utf8'
    }).trim()
    writeProcessRecord(recordPath, { pid: helper.pid, pgid: helper.pid - 1, command })

    expect(() => killRecordedProcess(recordPath, marker)).toThrow(
      'Recorded benchmark helper identity is invalid'
    )
    expect(() => process.kill(helper.pid, 0)).not.toThrow()
  })
})
