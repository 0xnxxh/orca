import { describe, expect, it } from 'vitest'
import { mobileRelayMintFailureFromUnknown } from './mobile-relay-mint-failure'

describe('mobileRelayMintFailureFromUnknown', () => {
  it('keeps known machine-readable Relay codes for diagnostics', () => {
    expect(
      mobileRelayMintFailureFromUnknown({
        stage: 'create_pairing_relay',
        error: new Error('relay_control_not_active'),
        fallbackCode: 'relay_mint_failed',
        fallbackMessage: 'Relay pairing invite request failed'
      })
    ).toEqual({
      code: 'relay_control_not_active',
      stage: 'create_pairing_relay',
      message: 'Relay pairing invite request failed'
    })
  })

  it('redacts free-form error messages', () => {
    expect(
      mobileRelayMintFailureFromUnknown({
        stage: 'create_pairing_relay',
        error: new Error('request failed for https://relay.example/token/secret'),
        fallbackCode: 'relay_mint_failed',
        fallbackMessage: 'Relay pairing invite request failed'
      })
    ).toEqual({
      code: 'relay_mint_failed',
      stage: 'create_pairing_relay',
      message: 'Relay pairing invite request failed'
    })
  })
})
