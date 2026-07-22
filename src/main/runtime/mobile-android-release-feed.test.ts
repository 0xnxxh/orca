import { describe, expect, it } from 'vitest'
import { extractLatestAndroidVersion } from './mobile-android-release-feed'

describe('extractLatestAndroidVersion', () => {
  it('picks the newest stable mobile-android tag', () => {
    const version = extractLatestAndroidVersion([
      { tag_name: 'mobile-android-v0.0.30' },
      { tag_name: 'mobile-android-v0.0.31' },
      { tag_name: 'mobile-android-v0.0.9' },
      { tag_name: 'v1.4.150' }, // desktop release — ignored
      { tag_name: 'mobile-ios-v0.0.31' } // iOS is never sourced here
    ])
    // Why: numeric compare, so 0.0.31 beats 0.0.9 (string compare would invert).
    expect(version).toBe('0.0.31')
  })

  it('skips drafts and prereleases', () => {
    const version = extractLatestAndroidVersion([
      { tag_name: 'mobile-android-v0.0.40', prerelease: true },
      { tag_name: 'mobile-android-v0.0.41', draft: true },
      { tag_name: 'mobile-android-v0.0.31' }
    ])
    expect(version).toBe('0.0.31')
  })

  it('rejects non-semver and malformed tags, failing open to null', () => {
    expect(
      extractLatestAndroidVersion([
        { tag_name: 'mobile-android-vlatest' },
        { tag_name: 'mobile-android-v0.0' },
        { tag_name: 42 },
        {}
      ])
    ).toBeNull()
    expect(extractLatestAndroidVersion([])).toBeNull()
  })
})
