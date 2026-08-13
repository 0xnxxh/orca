import { describe, expect, it } from 'vitest'
import type { Cookie } from 'electron'
import {
  cdpRestoreParamsFromIdentity,
  cookieClearIdentitiesFromCdp
} from './browser-cookie-clear-store'

const chipsCookie: Cookie = {
  domain: 'app.acme-chips.test',
  name: 'chips-auth',
  path: '/',
  secure: true,
  sameSite: 'no_restriction',
  value: 'keep-me'
}

describe('cookie clear CDP identities', () => {
  it('captures a CHIPS partition key for restore and never invents one', () => {
    const identities = cookieClearIdentitiesFromCdp(
      [{ cookie: chipsCookie, url: 'https://app.acme-chips.test/' }],
      [
        {
          name: 'chips-auth',
          value: 'keep-me',
          domain: 'app.acme-chips.test',
          path: '/',
          secure: true,
          sameSite: 'None',
          partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
        }
      ]
    )

    expect(identities).toEqual([
      expect.objectContaining({
        name: 'chips-auth',
        partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
      })
    ])
    expect(cdpRestoreParamsFromIdentity(identities[0])).toEqual(
      expect.objectContaining({
        name: 'chips-auth',
        sameSite: 'None',
        partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
      })
    )
  })

  it('fails closed when CDP cannot identify a removable cookie', () => {
    expect(() =>
      cookieClearIdentitiesFromCdp(
        [{ cookie: chipsCookie, url: 'https://app.acme-chips.test/' }],
        []
      )
    ).toThrow(/Could not snapshot cookie identity/)
  })
})
