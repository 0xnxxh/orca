import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __clearSelfMoveRegistryForTests,
  __getSelfMoveRegistrySizeForTests,
  clearSelfMove,
  isRecentSelfMoveSource,
  isRecentSelfMoveTarget,
  recordSelfMove,
  SELF_MOVE_REMOTE_TTL_MS
} from './editor-self-move-registry'

describe('editor-self-move-registry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __clearSelfMoveRegistryForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    __clearSelfMoveRegistryForTests()
  })

  it('records both endpoints with the right direction', () => {
    recordSelfMove('/repo/old.md', '/repo/sub/new.md')

    expect(isRecentSelfMoveSource('/repo/old.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/sub/new.md')).toBe(true)
    // Directions don't cross: the source is not a target and vice-versa.
    expect(isRecentSelfMoveTarget('/repo/old.md')).toBe(false)
    expect(isRecentSelfMoveSource('/repo/sub/new.md')).toBe(false)
  })

  it('expires stamps after the TTL', () => {
    recordSelfMove('/repo/old.md', '/repo/new.md', undefined, 750)
    expect(isRecentSelfMoveTarget('/repo/new.md')).toBe(true)

    vi.advanceTimersByTime(751)
    expect(isRecentSelfMoveTarget('/repo/new.md')).toBe(false)
    expect(isRecentSelfMoveSource('/repo/old.md')).toBe(false)
  })

  it('honors the longer remote TTL for runtime-backed moves', () => {
    recordSelfMove('/repo/old.md', '/repo/new.md', 'env-1', SELF_MOVE_REMOTE_TTL_MS)

    vi.advanceTimersByTime(1000)
    // A local-sized window would already have expired; the remote TTL keeps it.
    expect(isRecentSelfMoveTarget('/repo/new.md', 'env-1')).toBe(true)
  })

  it('isolates stamps by runtime owner', () => {
    recordSelfMove('/repo/old.md', '/repo/new.md', 'env-1')

    expect(isRecentSelfMoveTarget('/repo/new.md', 'env-1')).toBe(true)
    // A different owner (or the local client) must not match the remote stamp.
    expect(isRecentSelfMoveTarget('/repo/new.md', 'env-2')).toBe(false)
    expect(isRecentSelfMoveTarget('/repo/new.md')).toBe(false)
  })

  it('keeps both roles of a path when a move is immediately undone', () => {
    // Move A → B, then undo B → A. A must remain a live source (of the first
    // move, whose delayed watcher echo may still be in flight) AND a live target
    // (of the undo); likewise B. A single mutable direction per path would let
    // the undo clobber the first move's source stamp.
    recordSelfMove('/repo/A.md', '/repo/B.md')
    recordSelfMove('/repo/B.md', '/repo/A.md')

    expect(isRecentSelfMoveSource('/repo/A.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/A.md')).toBe(true)
    expect(isRecentSelfMoveSource('/repo/B.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/B.md')).toBe(true)
  })

  it('clears the roles a move stamped when the rename fails', () => {
    recordSelfMove('/repo/old.md', '/repo/new.md')
    clearSelfMove('/repo/old.md', '/repo/new.md')

    expect(isRecentSelfMoveSource('/repo/old.md')).toBe(false)
    expect(isRecentSelfMoveTarget('/repo/new.md')).toBe(false)
  })

  it('clear keeps a concurrent move’s SAME-role stamp on a shared destination', () => {
    // Drag /one/report.md and /two/report.md into /dest in quick succession:
    // both stamp /dest/report.md as a target. The first move succeeds; the
    // second fails (destination now exists) and clears. The successful move's
    // target stamp must survive so its delayed echo is still recognized.
    recordSelfMove('/one/report.md', '/dest/report.md') // move A
    recordSelfMove('/two/report.md', '/dest/report.md') // move B (will fail)

    clearSelfMove('/two/report.md', '/dest/report.md') // B's failure clear

    expect(isRecentSelfMoveTarget('/dest/report.md')).toBe(true)
    // B's own source is gone; A's source is untouched.
    expect(isRecentSelfMoveSource('/two/report.md')).toBe(false)
    expect(isRecentSelfMoveSource('/one/report.md')).toBe(true)
  })

  it('clear fully releases a target once every registration is cleared', () => {
    recordSelfMove('/one/report.md', '/dest/report.md')
    recordSelfMove('/two/report.md', '/dest/report.md')

    clearSelfMove('/one/report.md', '/dest/report.md')
    clearSelfMove('/two/report.md', '/dest/report.md')

    expect(isRecentSelfMoveTarget('/dest/report.md')).toBe(false)
  })

  it('clear leaves a concurrent move’s role on the same path intact', () => {
    // Move A → B, then C → A. Clearing the failed C → A must not drop A's source
    // role from the successful A → B move.
    recordSelfMove('/repo/A.md', '/repo/B.md')
    recordSelfMove('/repo/C.md', '/repo/A.md')

    clearSelfMove('/repo/C.md', '/repo/A.md')

    expect(isRecentSelfMoveSource('/repo/A.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/A.md')).toBe(false)
    expect(isRecentSelfMoveSource('/repo/C.md')).toBe(false)
  })

  it('caps the number of stamps', () => {
    for (let i = 0; i < 700; i++) {
      recordSelfMove(`/repo/from-${i}.md`, `/repo/to-${i}.md`)
    }
    // Two distinct endpoints per move (1400 keys) bounded by the 1024 cap.
    expect(__getSelfMoveRegistrySizeForTests()).toBeLessThanOrEqual(1024)
  })
})
