import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAndroidReleaseFeedCacheForTests,
  __setAndroidReleaseFeedFetcherForTests,
  extractLatestAndroidVersion,
  getRecommendedAndroidVersion,
  isAndroidReleaseFeedRefreshPending
} from './mobile-android-release-feed'

afterEach(() => {
  __resetAndroidReleaseFeedCacheForTests()
  vi.restoreAllMocks()
})

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

  it('accepts the published mobile channel while skipping drafts', () => {
    const version = extractLatestAndroidVersion([
      { tag_name: 'mobile-android-v0.0.40', prerelease: true },
      { tag_name: 'mobile-android-v0.0.41', draft: true },
      { tag_name: 'mobile-android-v0.0.31' }
    ])
    // Android workflow releases use --prerelease to avoid replacing desktop latest.
    expect(version).toBe('0.0.40')
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

  it('deduplicates a cold refresh and exposes its completion without blocking callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ tag_name: 'mobile-android-v0.0.40', prerelease: true }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    __setAndroidReleaseFeedFetcherForTests(fetchMock)

    expect(getRecommendedAndroidVersion(1_000)).toBeNull()
    expect(getRecommendedAndroidVersion(1_000)).toBeNull()
    expect(isAndroidReleaseFeedRefreshPending()).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()

    await vi.waitFor(() => {
      expect(isAndroidReleaseFeedRefreshPending()).toBe(false)
    })
    expect(getRecommendedAndroidVersion(1_000)).toBe('0.0.40')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
