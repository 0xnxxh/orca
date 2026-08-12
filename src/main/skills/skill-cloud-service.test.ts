import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillCloudService } from './skill-cloud-service'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SkillCloudService bearer links', () => {
  it('resolves and grants downloads without an Orca session', async () => {
    const requests: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push(init ?? {})
        return String(input).endsWith('/download-grants')
          ? Response.json({
              grant: { url: 'https://storage.test/package', expiresAt: '2026-08-11T00:05:00Z' },
              version: { versionId: 'ver_1' }
            })
          : Response.json({ share: { id: 'share_1', version: { versionId: 'ver_1' } } })
      })
    )
    const service = new SkillCloudService('/unused')
    const options = { apiUrl: 'http://127.0.0.1:8787' }

    await expect(service.resolveShare('share_1', options)).resolves.toMatchObject({ status: 'ok' })
    await expect(service.createDownloadGrant('share_1', options)).resolves.toMatchObject({
      status: 'ok'
    })

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(new Headers(request.headers).has('authorization')).toBe(false)
    }
  })
})
