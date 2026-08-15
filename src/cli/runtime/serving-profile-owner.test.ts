import { describe, expect, it } from 'vitest'
import type { CliStatusResult } from '../../shared/runtime-types'
import {
  STARTING_OWNER_TRUST_WINDOW_MS,
  findServingProfileOwner,
  serveAlreadyRunningFailure,
  serveAlreadyRunningMessage
} from './serving-profile-owner'

const NOW = 1_700_000_000_000

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
    // Why: an answered RPC proves ownership outright, so age is irrelevant.
    expect(
      findServingProfileOwner(status({ running: true, pid: 4242, reachable: true }), 0, NOW)
    ).toEqual({ pid: 4242, reachable: true })
  })

  it('reports an owner that is still starting up', () => {
    // Why: a serve that has written metadata but not opened its socket still
    // owns the profile; spawning a second one is what STA-4336 crash-loops on.
    expect(
      findServingProfileOwner(
        status({ running: true, pid: 77, reachable: false }),
        NOW - 5_000,
        NOW
      )
    ).toEqual({ pid: 77, reachable: false })
  })

  it('stops believing an unreachable owner that never finished starting', () => {
    // Why: an unreachable owner is trusted on its recorded pid alone. Once the
    // OS recycles that pid the claim is permanent, and `orca serve` would exit 3
    // forever with no runtime to show for it.
    expect(
      findServingProfileOwner(
        status({ running: true, pid: 77, reachable: false }),
        NOW - STARTING_OWNER_TRUST_WINDOW_MS - 1,
        NOW
      )
    ).toBeNull()
  })

  it('keeps refusing when metadata carries no start time', () => {
    // Why: an absent startedAt is not evidence of staleness, and guessing "old"
    // would reopen the duplicate-spawn window this whole change closes.
    expect(
      findServingProfileOwner(status({ running: true, pid: 77, reachable: false }), null, NOW)
    ).toEqual({ pid: 77, reachable: false })
  })

  it('does not treat a stale profile as an owner', () => {
    expect(findServingProfileOwner(status({ running: false, pid: null }), NOW, NOW)).toBeNull()
  })
})

const METADATA_PATH = '/profile/orca-runtime.json'

describe('serveAlreadyRunningMessage', () => {
  it('names the owning pid and stays actionable', () => {
    const message = serveAlreadyRunningMessage({ pid: 4242, reachable: true }, METADATA_PATH)

    expect(message).toContain('pid 4242')
    expect(message).toContain('not starting a second process')
    expect(message).toContain('orca status')
  })

  it('does not send a reachable owner to delete live metadata', () => {
    expect(serveAlreadyRunningMessage({ pid: 4242, reachable: true }, METADATA_PATH)).not.toContain(
      METADATA_PATH
    )
  })

  it('offers a recovery path when the owner is only believed on its pid', () => {
    // Why: an unreachable owner is trusted on a recorded pid alone, and a
    // recycled pid would otherwise refuse every serve on this profile forever.
    const message = serveAlreadyRunningMessage({ pid: 9, reachable: false }, METADATA_PATH)

    expect(message).toContain('starting up')
    expect(message).toContain(`delete ${METADATA_PATH}`)
  })

  it('stays readable when the owner pid is unknown', () => {
    expect(serveAlreadyRunningMessage({ pid: null, reachable: true }, METADATA_PATH)).toContain(
      'another process'
    )
  })
})

describe('serveAlreadyRunningFailure', () => {
  it('matches the envelope shape CLI json consumers already parse', () => {
    const failure = serveAlreadyRunningFailure({ pid: 4242, reachable: false }, METADATA_PATH)

    expect(failure).toEqual({
      id: 'local',
      ok: false,
      error: {
        code: 'runtime_serve_already_running',
        message: serveAlreadyRunningMessage({ pid: 4242, reachable: false }, METADATA_PATH),
        data: { pid: 4242, reachable: false, metadataPath: METADATA_PATH }
      },
      _meta: { runtimeId: null }
    })
  })
})
