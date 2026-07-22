import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAndroidReleaseFeedCacheForTests,
  __setAndroidReleaseFeedFetcherForTests,
  extractAndroidVersionCandidates,
  getRecommendedAndroidVersion,
  isAndroidReleaseFeedRefreshPending
} from './mobile-android-release-feed'

afterEach(() => {
  __resetAndroidReleaseFeedCacheForTests()
  vi.restoreAllMocks()
})

describe('extractAndroidVersionCandidates', () => {
  it('sorts exact mobile-android tag refs newest first', () => {
    const versions = extractAndroidVersionCandidates([
      { ref: 'refs/tags/mobile-android-v0.0.30' },
      { ref: 'refs/tags/mobile-android-v0.0.31' },
      { ref: 'refs/tags/mobile-android-v0.0.9' },
      { ref: 'refs/tags/v1.4.150' }, // desktop release — ignored
      { ref: 'refs/tags/mobile-ios-v0.0.31' } // iOS is never sourced here
    ])
    // Why: numeric compare, so 0.0.31 beats 0.0.9 (string compare would invert).
    expect(versions).toEqual(['0.0.31', '0.0.30', '0.0.9'])
  })

  it('rejects non-semver and malformed refs', () => {
    expect(
      extractAndroidVersionCandidates([
        { ref: 'refs/tags/mobile-android-vlatest' },
        { ref: 'refs/tags/mobile-android-v0.0' },
        { ref: 42 },
        {}
      ])
    ).toEqual([])
  })

  it('deduplicates a cold refresh and verifies the published APK', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/git/matching-refs/')
        ? jsonResponse([{ ref: 'refs/tags/mobile-android-v0.0.40' }])
        : jsonResponse({
            tag_name: 'mobile-android-v0.0.40',
            draft: false,
            prerelease: true,
            assets: [{ name: 'app-release.apk' }]
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
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back when newer tags lack a confirmed published APK', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/git/matching-refs/')) {
        return jsonResponse([
          { ref: 'refs/tags/mobile-android-v0.0.42' },
          { ref: 'refs/tags/mobile-android-v0.0.41' },
          { ref: 'refs/tags/mobile-android-v0.0.40' }
        ])
      }
      const version = url.match(/mobile-android-v(\d+\.\d+\.\d+)$/)?.[1] ?? ''
      return jsonResponse({
        tag_name: `mobile-android-v${version}`,
        draft: version === '0.0.41' ? 'false' : false,
        assets: version === '0.0.42' ? [] : [{ name: 'app-release.apk' }]
      })
    })
    __setAndroidReleaseFeedFetcherForTests(fetchMock)

    expect(getRecommendedAndroidVersion(1_000)).toBeNull()
    await vi.waitFor(() => expect(isAndroidReleaseFeedRefreshPending()).toBe(false))

    expect(getRecommendedAndroidVersion(1_000)).toBe('0.0.40')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('fails open without probing more tags after a provider failure', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/git/matching-refs/')
        ? jsonResponse([
            { ref: 'refs/tags/mobile-android-v0.0.41' },
            { ref: 'refs/tags/mobile-android-v0.0.40' }
          ])
        : jsonResponse({ message: 'rate limited' }, 403)
    )
    __setAndroidReleaseFeedFetcherForTests(fetchMock)

    expect(getRecommendedAndroidVersion(1_000)).toBeNull()
    await vi.waitFor(() => expect(isAndroidReleaseFeedRefreshPending()).toBe(false))

    expect(getRecommendedAndroidVersion(1_000)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
