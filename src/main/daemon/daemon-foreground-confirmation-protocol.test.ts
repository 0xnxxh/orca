import { describe, expect, it } from 'vitest'
import { PREVIOUS_DAEMON_PROTOCOL_VERSIONS, PROTOCOL_VERSION } from './types'

describe('foreground-confirmation daemon protocol', () => {
  it('rejects daemons from before the fresh-confirmation RPC', () => {
    expect(PROTOCOL_VERSION).toBe(25)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(19)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(22)
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(23)
    // Why: abandoning a live v24 daemon would hide its terminals and leave its
    // lock-holding processes running; only fresh v25 sessions gain Job ownership.
    expect(PREVIOUS_DAEMON_PROTOCOL_VERSIONS).toContain(24)
  })
})
