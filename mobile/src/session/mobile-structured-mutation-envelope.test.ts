import { describe, expect, it } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../src/shared/agent-session-mutation-envelope'
import {
  createMobileStructuredOperationId,
  mobileStructuredPayloadFingerprint
} from './mobile-structured-mutation-envelope'

describe('mobile structured mutation envelope', () => {
  it('matches the host fingerprint across nested property order and undefined fields', () => {
    const input = {
      method: 'agentSession.send',
      sessionId: 'mobile_1',
      fields: {
        body: {
          role: 'user',
          blocks: [{ text: 'hello', omitted: undefined, type: 'text' }],
          kind: 'message'
        }
      }
    }

    expect(mobileStructuredPayloadFingerprint(input)).toBe(
      computeAgentSessionPayloadFingerprint(input)
    )
  })

  it('mints timestamped operation ids', () => {
    expect(createMobileStructuredOperationId('mobile-send', () => 'uuid', 1_700_000_000_000)).toBe(
      'mobile-send:loyw3v28:uuid'
    )
  })
})
