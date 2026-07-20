import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __clearSelfMoveRegistryForTests,
  __getSelfMoveRegistrySizeForTests,
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

  it('caps the number of stamps', () => {
    for (let i = 0; i < 400; i++) {
      recordSelfMove(`/repo/from-${i}.md`, `/repo/to-${i}.md`)
    }
    // Two endpoints per move, bounded by the 256 cap.
    expect(__getSelfMoveRegistrySizeForTests()).toBeLessThanOrEqual(256)
  })
})
