import { describe, expect, it } from 'vitest'
import { MOBILE_WEB_BRIDGE_PROTOCOL_VERSION } from './bridge-protocol-version'
import {
  MOBILE_WEB_BRIDGE_FLOOR_RETENTION_STABLE_RELEASES,
  MOBILE_WEB_FIRST_PRODUCTION_BRIDGE_VERSION,
  MOBILE_WEB_PACKAGE_BRIDGE_RANGE
} from './bridge-release-policy'

describe('mobile web bridge release policy', () => {
  it('keeps the first production package on the exact v2 contract', () => {
    expect(MOBILE_WEB_FIRST_PRODUCTION_BRIDGE_VERSION).toBe(2)
    expect(MOBILE_WEB_BRIDGE_PROTOCOL_VERSION).toBe(2)
    expect(MOBILE_WEB_PACKAGE_BRIDGE_RANGE).toEqual({
      minimum: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
      testedThrough: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION
    })
  })

  it('requires two stable releases before retiring a bridge floor', () => {
    expect(MOBILE_WEB_BRIDGE_FLOOR_RETENTION_STABLE_RELEASES).toBe(2)
  })
})
