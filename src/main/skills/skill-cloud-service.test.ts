import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillCloudService } from './skill-cloud-service'

const { packaged } = vi.hoisted(() => ({ packaged: { value: false } }))
const createdPaths: string[] = []

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return packaged.value
    }
  }
}))

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
  packaged.value = false
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function userDataPath(): string {
  const path = mkdtempSync(join(tmpdir(), 'orca-skill-cloud-service-'))
  createdPaths.push(path)
  return path
}

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

  it('uses the development auth token without opening a profile session', async () => {
    vi.stubEnv('ORCA_CLOUD_AUTH_TOKEN', 'desktop-e2e-token')
    const requests: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
        requests.push(init ?? {})
        return Response.json({ shares: [] })
      })
    )

    await expect(
      new SkillCloudService(userDataPath()).listOwnedShares({ apiUrl: 'http://127.0.0.1:8787' })
    ).resolves.toEqual({ status: 'ok', value: [] })

    expect(new Headers(requests[0]?.headers).get('authorization')).toBe('Bearer desktop-e2e-token')
  })

  it('rejects the development auth token in packaged builds', async () => {
    packaged.value = true
    vi.stubEnv('ORCA_CLOUD_AUTH_TOKEN', 'desktop-e2e-token')

    await expect(
      new SkillCloudService(userDataPath()).listOwnedShares({ apiUrl: 'https://share.onorca.dev' })
    ).rejects.toThrow('available only in development builds')
  })
})
