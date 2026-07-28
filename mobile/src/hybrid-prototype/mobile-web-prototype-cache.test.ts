import AsyncStorage from '@react-native-async-storage/async-storage'
import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadCachedMobileWebPrototypePackage,
  saveMobileWebPrototypePackage
} from './mobile-web-prototype-cache'
import type { VerifiedMobileWebPrototypePackage } from './mobile-web-prototype-package'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  }
}))

const values = new Map<string, string>()

function prototypePackage(html: string): VerifiedMobileWebPrototypePackage {
  const bytes = Buffer.from(html, 'utf8')
  const buildId = Buffer.from(sha256(bytes)).toString('hex')
  return {
    manifest: {
      protocolVersion: 1,
      buildId,
      sha256: buildId,
      byteLength: bytes.byteLength,
      chunkBytes: 48 * 1024,
      contentType: 'text/html; charset=utf-8'
    },
    html
  }
}

describe('mobile web prototype cache', () => {
  beforeEach(() => {
    values.clear()
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.removeItem).mockReset()
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => values.get(key) ?? null)
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      values.set(key, value)
    })
    vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
      values.delete(key)
    })
  })

  it('publishes the package before its per-host pointer and reloads it', async () => {
    const cached = prototypePackage('<p>cached</p>')
    await saveMobileWebPrototypePackage('secret-host-identity', cached)

    const writes = vi.mocked(AsyncStorage.setItem).mock.calls
    expect(writes).toHaveLength(2)
    expect(writes[0]?.[0]).toContain(':package:')
    expect(writes[1]?.[0]).toContain(':active')
    expect(writes.some(([key]) => key.includes('secret-host-identity'))).toBe(false)
    await expect(loadCachedMobileWebPrototypePackage('secret-host-identity')).resolves.toEqual(
      cached
    )
  })

  it('rejects a cached document modified after verification', async () => {
    const cached = prototypePackage('<p>trusted</p>')
    await saveMobileWebPrototypePackage('host', cached)
    const packageEntry = [...values.entries()].find(([key]) => key.includes(':package:'))
    expect(packageEntry).toBeDefined()
    values.set(
      packageEntry![0],
      JSON.stringify({ ...cached, html: '<p>modified after caching</p>' })
    )

    await expect(loadCachedMobileWebPrototypePackage('host')).resolves.toBeNull()
  })

  it('keeps the previous package if publishing the new pointer fails', async () => {
    const previous = prototypePackage('<p>previous</p>')
    const next = prototypePackage('<p>next</p>')
    await saveMobileWebPrototypePackage('host', previous)
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      if (key.endsWith(':active')) {
        throw new Error('storage failure')
      }
      values.set(key, value)
    })

    await expect(saveMobileWebPrototypePackage('host', next)).rejects.toThrow('storage failure')
    await expect(loadCachedMobileWebPrototypePackage('host')).resolves.toEqual(previous)
  })
})
