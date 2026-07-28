import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MOBILE_WEB_PROTOTYPE_CHUNK_BYTES,
  MOBILE_WEB_PROTOTYPE_MAX_BYTES
} from '../../../shared/mobile-web-prototype-contract'
import {
  getMobileWebPrototypeChunk,
  getMobileWebPrototypeManifest
} from './mobile-web-prototype-assets'

describe('mobile web prototype assets', () => {
  it('serves a content-addressed document in bounded chunks', () => {
    const manifest = getMobileWebPrototypeManifest()
    const chunks: Buffer[] = []

    for (let offset = 0; offset < manifest.byteLength; offset += manifest.chunkBytes) {
      const chunk = getMobileWebPrototypeChunk(manifest.buildId, offset)
      expect(chunk.offset).toBe(offset)
      expect(chunk.byteLength).toBeLessThanOrEqual(MOBILE_WEB_PROTOTYPE_CHUNK_BYTES)
      chunks.push(Buffer.from(chunk.dataBase64, 'base64'))
    }

    const document = Buffer.concat(chunks).toString('utf8')
    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain('window.ReactNativeWebView.postMessage')
    expect(document).toContain('id="run-probe"')
    expect(manifest.byteLength).toBeGreaterThan(320 * 1024)
    expect(manifest.byteLength).toBeLessThan(MOBILE_WEB_PROTOTYPE_MAX_BYTES)
    expect(document).toContain(
      `const packageKiB=Number("${String(Math.ceil(manifest.byteLength / 1024)).padStart(6, '0')}")`
    )
    expect(Buffer.byteLength(document)).toBe(manifest.byteLength)
  })

  it('rejects stale build identities and invalid offsets', () => {
    const manifest = getMobileWebPrototypeManifest()
    expect(() => getMobileWebPrototypeChunk('0'.repeat(64), 0)).toThrow(
      'mobile_web_prototype_build_changed'
    )
    expect(() => getMobileWebPrototypeChunk(manifest.buildId, manifest.byteLength)).toThrow(
      'mobile_web_prototype_offset_invalid'
    )
  })

  it('binds the exact inline code to a network-disabled content policy', () => {
    const document = Buffer.from(
      getMobileWebPrototypeChunk(getMobileWebPrototypeManifest().buildId, 0).dataBase64,
      'base64'
    ).toString('utf8')
    const style = document.match(/<style>([\s\S]*?)<\/style>/)?.[1]
    const script = document.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(style).toBeDefined()
    expect(script).toBeDefined()

    const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('base64')
    expect(document).toContain(`style-src 'sha256-${hash(style!)}'`)
    expect(document).toContain(`script-src 'sha256-${hash(script!)}'`)
    expect(document).toContain("connect-src 'none'")
    expect(document).not.toContain('fetch(')
  })
})
