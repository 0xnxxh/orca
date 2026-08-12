import { describe, expect, it, vi } from 'vitest'
import { resolveDaemonOccupancy, type DaemonOccupancyDeps } from './daemon-occupancy'
import type { inspectDaemonPtyOwnership } from './daemon-live-pty-evidence'

const SOCKET_PATH = '/tmp/orca-daemon.sock'
const TOKEN_PATH = '/tmp/orca-daemon.token'
const DAEMON_PID = 4242

type Ownership = Awaited<ReturnType<typeof inspectDaemonPtyOwnership>>

function ipcAnswers(count: number | null) {
  return vi.fn<NonNullable<DaemonOccupancyDeps['listSessions']>>(async () => count)
}

function ownershipIs(ownership: Ownership) {
  return vi.fn<typeof inspectDaemonPtyOwnership>(async () => ownership)
}

function resolve(
  deps: DaemonOccupancyDeps,
  recordedPid: number | null = DAEMON_PID
): Promise<Awaited<ReturnType<typeof resolveDaemonOccupancy>>> {
  return resolveDaemonOccupancy({
    socketPath: SOCKET_PATH,
    tokenPath: TOKEN_PATH,
    recordedPid,
    deps
  })
}

describe('resolveDaemonOccupancy with a daemon that answered', () => {
  it('reports occupied with the counted sessions, without consulting the process table', async () => {
    const listSessions = ipcAnswers(3)
    const inspectPtyOwnership = ownershipIs('no-live-ptys')

    await expect(resolve({ listSessions, inspectPtyOwnership })).resolves.toEqual({
      state: 'occupied',
      liveSessions: 3
    })
    expect(listSessions).toHaveBeenCalledWith(SOCKET_PATH, TOKEN_PATH)
    // The daemon's own reply is authoritative; process-table evidence could only muddy it.
    expect(inspectPtyOwnership).not.toHaveBeenCalled()
  })

  it('reports empty on a count of zero, without consulting the process table', async () => {
    // The one state that licenses a kill, and only the daemon itself can establish it.
    const listSessions = ipcAnswers(0)
    const inspectPtyOwnership = ownershipIs('owns-live-ptys')

    await expect(resolve({ listSessions, inspectPtyOwnership })).resolves.toEqual({
      state: 'empty',
      liveSessions: 0
    })
    expect(inspectPtyOwnership).not.toHaveBeenCalled()
  })

  it('reports occupied for a single session', async () => {
    await expect(
      resolve({ listSessions: ipcAnswers(1), inspectPtyOwnership: ownershipIs('unknown') })
    ).resolves.toEqual({ state: 'occupied', liveSessions: 1 })
  })
})

describe('resolveDaemonOccupancy when the daemon could not answer', () => {
  it('raises to occupied on process-table evidence, keyed to the recorded pid', async () => {
    const inspectPtyOwnership = ownershipIs('owns-live-ptys')

    await expect(resolve({ listSessions: ipcAnswers(null), inspectPtyOwnership })).resolves.toEqual(
      {
        state: 'occupied',
        liveSessions: null
      }
    )
    expect(inspectPtyOwnership).toHaveBeenCalledWith(DAEMON_PID)
  })

  it('stays unknown — never empty — when the process table shows no live PTYs', async () => {
    // The asymmetry the module exists for: the table may only ever *raise* the answer.
    // A daemon too wedged to list its sessions is exactly as likely to be hosting them,
    // and ps can miss PTYs it never observed. Reading this as 'empty' would license
    // killing live agents unrecoverably; 'unknown' is the residual, not permission.
    const inspectPtyOwnership = ownershipIs('no-live-ptys')

    await expect(resolve({ listSessions: ipcAnswers(null), inspectPtyOwnership })).resolves.toEqual(
      {
        state: 'unknown',
        liveSessions: null
      }
    )
    expect(inspectPtyOwnership).toHaveBeenCalledWith(DAEMON_PID)
  })

  it('stays unknown when the process table could not be read', async () => {
    await expect(
      resolve({ listSessions: ipcAnswers(null), inspectPtyOwnership: ownershipIs('unknown') })
    ).resolves.toEqual({ state: 'unknown', liveSessions: null })
  })

  it('stays unknown without inspecting an unverified pid', async () => {
    // A pid we could not tie back to this daemon may have been recycled; its children
    // would be some other process's, and counting them is evidence about the wrong tree.
    const inspectPtyOwnership = ownershipIs('owns-live-ptys')

    await expect(
      resolve({ listSessions: ipcAnswers(null), inspectPtyOwnership }, null)
    ).resolves.toEqual({ state: 'unknown', liveSessions: null })
    expect(inspectPtyOwnership).not.toHaveBeenCalled()
  })
})

describe('resolveDaemonOccupancy when an injected dep throws', () => {
  it('propagates an inspector rejection rather than degrading to unknown', async () => {
    // Pins current behavior, and it is a gap: the shipped inspector swallows its own
    // failures, so this only bites an injected or future-refactored one. A throw here
    // escapes into the launch path instead of landing on the safe 'unknown' residual.
    const inspectPtyOwnership = vi.fn<typeof inspectDaemonPtyOwnership>(async () => {
      throw new Error('process table read exploded')
    })

    await expect(resolve({ listSessions: ipcAnswers(null), inspectPtyOwnership })).rejects.toThrow(
      'process table read exploded'
    )
  })

  it('propagates a failing listSessions dep, which the real one never does', async () => {
    // countLiveSessionsOverIpc catches internally and returns null; an injected dep is
    // not held to that, and the module adds no guard of its own.
    await expect(
      resolve({
        listSessions: async () => {
          throw new Error('socket vanished')
        },
        inspectPtyOwnership: ownershipIs('owns-live-ptys')
      })
    ).rejects.toThrow('socket vanished')
  })
})
