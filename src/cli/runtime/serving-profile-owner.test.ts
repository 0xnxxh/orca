import { describe, expect, it } from 'vitest'
import type { CliStatusResult } from '../../shared/runtime-types'
import {
  findServingProfileOwner,
  serveAlreadyRunningFailure,
  serveAlreadyRunningMessage
} from './serving-profile-owner'

function status(overrides: Partial<CliStatusResult['app']> & { reachable?: boolean }) {
  const { reachable = false, ...app } = overrides
  return {
    app: { running: false, pid: null, ...app },
    runtime: { state: 'not_running', reachable, runtimeId: null },
    graph: { state: 'not_running' }
  } as CliStatusResult
}

describe('findServingProfileOwner', () => {
  it('reports the owner when the runtime answers RPC', () => {
    expect(findServingProfileOwner(status({ running: true, pid: 4242, reachable: true }))).toEqual({
      pid: 4242,
      reachable: true
    })
  })

  it('reports an owner that is still starting up', () => {
    // Why: a serve that has written metadata but not opened its socket still
    // owns the profile; spawning a second one is what STA-4336 crash-loops on.
    expect(findServingProfileOwner(status({ running: true, pid: 77, reachable: false }))).toEqual({
      pid: 77,
      reachable: false
    })
  })

  it('does not treat a stale profile as an owner', () => {
    expect(findServingProfileOwner(status({ running: false, pid: null }))).toBeNull()
  })
})

describe('serveAlreadyRunningMessage', () => {
  it('names the owning pid and stays actionable', () => {
    const message = serveAlreadyRunningMessage({ pid: 4242, reachable: true })

    expect(message).toContain('pid 4242')
    expect(message).toContain('not starting a second process')
    expect(message).toContain('orca status')
  })

  it('flags an owner that has not answered yet', () => {
    expect(serveAlreadyRunningMessage({ pid: 9, reachable: false })).toContain('(starting up)')
  })

  it('stays readable when the owner pid is unknown', () => {
    expect(serveAlreadyRunningMessage({ pid: null, reachable: true })).toContain('another process')
  })
})

describe('serveAlreadyRunningFailure', () => {
  it('matches the envelope shape CLI json consumers already parse', () => {
    const failure = serveAlreadyRunningFailure({ pid: 4242, reachable: false })

    expect(failure).toEqual({
      id: 'local',
      ok: false,
      error: {
        code: 'runtime_serve_already_running',
        message: serveAlreadyRunningMessage({ pid: 4242, reachable: false }),
        data: { pid: 4242, reachable: false }
      },
      _meta: { runtimeId: null }
    })
  })
})
