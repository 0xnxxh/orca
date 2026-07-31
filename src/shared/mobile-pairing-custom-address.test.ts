import { describe, expect, it } from 'vitest'
import { normalizeMobilePairingCustomAddress } from './mobile-pairing-custom-address'

describe('normalizeMobilePairingCustomAddress', () => {
  it('keeps a valid custom address', () => {
    expect(normalizeMobilePairingCustomAddress(' 100.126.117.25:6768 ')).toBe('100.126.117.25:6768')
  })

  it.each([null, undefined, 42, '', '0.0.0.0', 'host:99999'])(
    'clears an invalid persisted value: %s',
    (value) => {
      expect(normalizeMobilePairingCustomAddress(value)).toBeNull()
    }
  )
})
