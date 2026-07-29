import { describe, expect, it } from 'vitest'
import {
  assertMobileWebRnwExecutablePolicy,
  mobileWebRnwExecutablePolicyFailure
} from './mobile-web-rnw-executable-policy.mjs'

describe('mobile web RNW executable policy', () => {
  it.each([
    'localStorage.setItem("key","value")',
    'window.sessionStorage.getItem("key")',
    'indexedDB.open("orca")',
    'caches.open("orca")',
    'document.cookie="credential=value"',
    'openDatabase("orca","1","Orca",1024)',
    'navigator.storage.getDirectory()'
  ])('rejects page-owned persistence: %s', (source) => {
    expect(mobileWebRnwExecutablePolicyFailure(source)).toBe('page-owned persistence')
    expect(() => assertMobileWebRnwExecutablePolicy(source)).toThrow('page-owned persistence')
  })

  it('allows inert syntax-highlighter keyword strings', () => {
    expect(
      mobileWebRnwExecutablePolicyFailure('["document","localStorage","sessionStorage","module"]')
    ).toBeNull()
  })
})
