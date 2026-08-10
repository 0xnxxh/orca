import { describe, expect, it, vi } from 'vitest'
import {
  classifyRelease,
  enforceReleasePolicy,
  latestAllowedStableRelease
} from './enforce-release-policy.mjs'

function response(body = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body))
  }
}

function release(tag, overrides = {}) {
  return {
    id: 42,
    tag_name: tag,
    draft: false,
    prerelease: false,
    author: { login: 'github-actions[bot]' },
    ...overrides
  }
}

describe('classifyRelease', () => {
  it('allows automation-authored desktop and mobile release tags', () => {
    expect(classifyRelease(release('v1.4.178'))).toMatchObject({
      allowed: true,
      expectedPrerelease: false
    })
    expect(classifyRelease(release('v1.4.179-rc.2.perf'))).toMatchObject({
      allowed: true,
      expectedPrerelease: true
    })
    expect(classifyRelease(release('mobile-android-v0.0.43'))).toMatchObject({
      allowed: true,
      expectedPrerelease: true
    })
    expect(classifyRelease(release('mobile-v0.0.13'))).toMatchObject({
      allowed: true,
      expectedPrerelease: true
    })
  })

  it('rejects evidence tags and human-authored semver releases', () => {
    expect(
      classifyRelease(
        release('qa-pr13411-exact-head-58e91cb0d8-windows-wsl', {
          author: { login: 'OrcaWin' }
        })
      )
    ).toMatchObject({ allowed: false })
    expect(
      classifyRelease(release('v9.0.0', { author: { login: 'write-collaborator' } }))
    ).toMatchObject({ allowed: false })
  })

  it.each([
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3-rc.01',
    'mobile-v0.00.13',
    'mobile-android-v00.0.43'
  ])('rejects noncanonical release tag %s', (tag) => {
    expect(classifyRelease(release(tag))).toMatchObject({ allowed: false })
  })
})

describe('latestAllowedStableRelease', () => {
  it('selects by semver and ignores human-authored lookalikes', () => {
    expect(
      latestAllowedStableRelease([
        release('v1.4.178', { id: 178 }),
        release('v1.10.2', { id: 1102 }),
        release('v99.0.0', { id: 99, author: { login: 'write-collaborator' } }),
        release('v1.10.3', { id: 1103, draft: true })
      ])
    ).toMatchObject({ id: 1102, tag_name: 'v1.10.2' })
  })
})

describe('enforceReleasePolicy', () => {
  it('leaves a correctly classified automation release unchanged', async () => {
    const fetchImpl = vi.fn()

    await expect(
      enforceReleasePolicy({
        release: release('v1.4.178'),
        repo: 'stablyai/orca',
        token: 'token',
        fetchImpl,
        log: vi.fn()
      })
    ).resolves.toEqual({ action: 'allowed', tag: 'v1.4.178' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('repairs a prerelease that GitHub would otherwise consider latest', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([release('v1.4.178', { id: 178 })]))
      .mockResolvedValueOnce(response())

    await expect(
      enforceReleasePolicy({
        release: release('v1.4.179-rc.2'),
        repo: 'stablyai/orca',
        token: 'token',
        fetchImpl,
        log: vi.fn()
      })
    ).resolves.toEqual({ action: 'repaired', tag: 'v1.4.179-rc.2' })
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/stablyai/orca/releases/42',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ prerelease: true, make_latest: 'false' })
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://api.github.com/repos/stablyai/orca/releases/178',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ make_latest: 'true' })
      })
    )
  })

  it('hides then deletes a QA evidence release', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([release('v1.4.178', { id: 178 })]))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({}, 204))
      .mockResolvedValueOnce(response({}, 204))

    await expect(
      enforceReleasePolicy({
        release: release('qa-pr13411-exact-head-58e91cb0d8-windows-wsl', {
          author: { login: 'OrcaWin' }
        }),
        repo: 'stablyai/orca',
        token: 'token',
        fetchImpl,
        log: vi.fn()
      })
    ).resolves.toMatchObject({ action: 'deleted' })
    expect(fetchImpl.mock.calls.map(([, init]) => init.method)).toEqual([
      'PATCH',
      undefined,
      'PATCH',
      'DELETE',
      'DELETE'
    ])
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      draft: true,
      prerelease: true,
      make_latest: 'false'
    })
    expect(fetchImpl.mock.calls[2][0]).toBe(
      'https://api.github.com/repos/stablyai/orca/releases/178'
    )
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ make_latest: 'true' })
    expect(fetchImpl.mock.calls[4][0]).toBe(
      'https://api.github.com/repos/stablyai/orca/git/refs/tags/qa-pr13411-exact-head-58e91cb0d8-windows-wsl'
    )
  })
})
