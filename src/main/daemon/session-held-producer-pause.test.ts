import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRODUCER_PAUSE_FAILSAFE_MS, Session, type SubprocessHandle } from './session'

function createSubprocess(): SubprocessHandle & {
  pauseCalls: number
  resumeCalls: number
} {
  return {
    pid: 123,
    pauseCalls: 0,
    resumeCalls: 0,
    getForegroundProcess: () => null,
    write: () => {},
    resize: () => {},
    pause() {
      this.pauseCalls += 1
    },
    resume() {
      this.resumeCalls += 1
    },
    kill: () => {},
    forceKill: () => {},
    signal: () => {},
    onData: () => {},
    onExit: () => {},
    dispose: () => {}
  }
}

describe('Session exact held producer pause', () => {
  let session: Session
  let subprocess: ReturnType<typeof createSubprocess>

  beforeEach(() => {
    vi.useFakeTimers()
    subprocess = createSubprocess()
    session = new Session({
      sessionId: 'session',
      cols: 80,
      rows: 24,
      subprocess,
      shellReadySupported: false
    })
  })

  afterEach(() => {
    session.dispose()
    vi.useRealTimers()
  })

  it('stays paused beyond the legacy failsafe until explicit release', () => {
    expect(session.supportsExactHeldProducerPause()).toBe(true)
    expect(session.acquireExactHeldProducerPause('client-a', 'lease-a')).toBe(true)

    vi.advanceTimersByTime(PRODUCER_PAUSE_FAILSAFE_MS * 2)
    expect(subprocess.pauseCalls).toBe(1)
    expect(subprocess.resumeCalls).toBe(0)

    expect(session.releaseExactHeldProducerPause('client-a', 'lease-a')).toBe(true)
    expect(session.releaseExactHeldProducerPause('client-a', 'lease-a')).toBe(true)
    expect(subprocess.resumeCalls).toBe(1)
  })

  it('resumes only after every owner releases its idempotent lease', () => {
    expect(session.acquireExactHeldProducerPause('client-a', 'lease')).toBe(true)
    expect(session.acquireExactHeldProducerPause('client-a', 'lease')).toBe(true)
    expect(session.acquireExactHeldProducerPause('client-b', 'lease')).toBe(true)
    expect(subprocess.pauseCalls).toBe(1)

    expect(session.releaseExactHeldProducerPause('client-a', 'lease')).toBe(true)
    expect(subprocess.resumeCalls).toBe(0)
    expect(session.releaseExactHeldProducerPause('client-b', 'lease')).toBe(true)
    expect(subprocess.resumeCalls).toBe(1)
  })

  it('keeps an exact hold through legacy failsafe expiry', () => {
    session.pauseProducer()
    expect(session.acquireExactHeldProducerPause('client-a', 'lease')).toBe(true)

    vi.advanceTimersByTime(PRODUCER_PAUSE_FAILSAFE_MS)
    expect(subprocess.resumeCalls).toBe(0)
    expect(session.releaseExactHeldProducerPause('client-a', 'lease')).toBe(true)
    expect(subprocess.resumeCalls).toBe(1)
  })

  it('cleans up only the disconnected owner leases', () => {
    session.acquireExactHeldProducerPause('client-a', 'lease-a')
    session.acquireExactHeldProducerPause('client-b', 'lease-b')

    session.releaseExactHeldProducerPauses('client-a')
    expect(subprocess.resumeCalls).toBe(0)
    session.releaseExactHeldProducerPauses('client-b')
    expect(subprocess.resumeCalls).toBe(1)
  })

  it('does not let renderer reattachment implicitly release an exact lease', () => {
    session.attachClient({ onData: () => {}, onExit: () => {} })
    session.acquireExactHeldProducerPause('client-a', 'lease')

    session.detachAllClients()
    expect(subprocess.resumeCalls).toBe(0)
    session.attachClient({ onData: () => {}, onExit: () => {} })
    expect(subprocess.resumeCalls).toBe(0)
    session.releaseExactHeldProducerPause('client-a', 'lease')
    expect(subprocess.resumeCalls).toBe(1)
  })

  it('does not advertise a subprocess without native flow control', () => {
    session.dispose()
    const { pause: _pause, resume: _resume, ...unsupported } = createSubprocess()
    void _pause
    void _resume
    session = new Session({
      sessionId: 'unsupported',
      cols: 80,
      rows: 24,
      subprocess: unsupported,
      shellReadySupported: false
    })

    expect(session.supportsExactHeldProducerPause()).toBe(false)
    expect(session.acquireExactHeldProducerPause('client-a', 'lease')).toBe(false)
  })
})
