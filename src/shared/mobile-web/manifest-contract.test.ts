import { describe, expect, it } from 'vitest'
import {
  MOBILE_WEB_MANIFEST_SCHEMA_VERSION,
  MOBILE_WEB_MAX_ASSET_BYTES,
  MOBILE_WEB_MAX_ASSET_COUNT,
  MobileWebManifestSchema,
  serializeMobileWebManifestForBuildId,
  supportsMobileWebBridgeVersion,
  type MobileWebManifest
} from './manifest-contract'

const SCRIPT_HASH = 'a'.repeat(64)
const STYLE_HASH = 'b'.repeat(64)
const DOCUMENT_HASH = 'c'.repeat(64)

function validManifest(): MobileWebManifest {
  return {
    schemaVersion: MOBILE_WEB_MANIFEST_SCHEMA_VERSION,
    buildId: 'd'.repeat(64),
    bridge: { minimum: 1, testedThrough: 2 },
    entrypoint: 'index.html',
    totalBytes: 60,
    assets: [
      {
        path: `assets/${SCRIPT_HASH}.js`,
        sha256: SCRIPT_HASH,
        byteLength: 20,
        contentType: 'text/javascript; charset=utf-8',
        role: 'script'
      },
      {
        path: `assets/${STYLE_HASH}.css`,
        sha256: STYLE_HASH,
        byteLength: 10,
        contentType: 'text/css; charset=utf-8',
        role: 'style'
      },
      {
        path: 'index.html',
        sha256: DOCUMENT_HASH,
        byteLength: 30,
        contentType: 'text/html; charset=utf-8',
        role: 'document'
      }
    ]
  }
}

describe('mobile web manifest contract', () => {
  it('accepts a bounded, sorted, content-addressed package', () => {
    expect(MobileWebManifestSchema.safeParse(validManifest()).success).toBe(true)
  })

  it('rejects unknown fields at every object boundary', () => {
    expect(
      MobileWebManifestSchema.safeParse({ ...validManifest(), credential: 'do-not-accept' }).success
    ).toBe(false)
    const manifest = validManifest()
    manifest.assets[0] = { ...manifest.assets[0]!, sourcePath: '/secret' } as never
    expect(MobileWebManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it.each(['../index.html', '/index.html', 'assets//app.js', 'assets\\app.js', 'a%2Fb.js'])(
    'rejects unsafe asset path %s',
    (path) => {
      const manifest = validManifest()
      manifest.entrypoint = path
      manifest.assets[2] = { ...manifest.assets[2]!, path }
      expect(MobileWebManifestSchema.safeParse(manifest).success).toBe(false)
    }
  )

  it('requires the full asset hash in non-document paths', () => {
    const manifest = validManifest()
    manifest.assets[0] = { ...manifest.assets[0]!, path: `assets/${'e'.repeat(64)}.js` }
    expect(MobileWebManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('requires extension, content type, and role to agree', () => {
    const manifest = validManifest()
    manifest.assets[0] = { ...manifest.assets[0]!, contentType: 'text/css; charset=utf-8' }
    expect(MobileWebManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('requires one document matching the entrypoint', () => {
    const missingDocument = validManifest()
    missingDocument.entrypoint = `assets/${SCRIPT_HASH}.js`
    expect(MobileWebManifestSchema.safeParse(missingDocument).success).toBe(false)

    const duplicateDocument = validManifest()
    duplicateDocument.assets.splice(2, 0, { ...duplicateDocument.assets[2]! })
    duplicateDocument.totalBytes += 30
    expect(MobileWebManifestSchema.safeParse(duplicateDocument).success).toBe(false)
  })

  it('requires unique ascending paths and an exact total', () => {
    const unsorted = validManifest()
    unsorted.assets.reverse()
    expect(MobileWebManifestSchema.safeParse(unsorted).success).toBe(false)

    const wrongTotal = validManifest()
    wrongTotal.totalBytes += 1
    expect(MobileWebManifestSchema.safeParse(wrongTotal).success).toBe(false)
  })

  it('enforces bridge, per-asset, and file-count bounds', () => {
    const invalidBridge = validManifest()
    invalidBridge.bridge = { minimum: 3, testedThrough: 2 }
    expect(MobileWebManifestSchema.safeParse(invalidBridge).success).toBe(false)

    const oversizedAsset = validManifest()
    oversizedAsset.assets[0] = {
      ...oversizedAsset.assets[0]!,
      byteLength: MOBILE_WEB_MAX_ASSET_BYTES + 1
    }
    oversizedAsset.totalBytes = MOBILE_WEB_MAX_ASSET_BYTES + 41
    expect(MobileWebManifestSchema.safeParse(oversizedAsset).success).toBe(false)

    const tooManyAssets = validManifest()
    tooManyAssets.assets = Array.from(
      { length: MOBILE_WEB_MAX_ASSET_COUNT + 1 },
      () => tooManyAssets.assets[0]!
    )
    expect(MobileWebManifestSchema.safeParse(tooManyAssets).success).toBe(false)
  })

  it('accepts an asset exactly at the reviewed ceiling', () => {
    const manifest = validManifest()
    manifest.assets[0] = {
      ...manifest.assets[0]!,
      byteLength: MOBILE_WEB_MAX_ASSET_BYTES
    }
    manifest.totalBytes = MOBILE_WEB_MAX_ASSET_BYTES + 40

    expect(MobileWebManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('accepts only shell bridge versions inside the declared tested range', () => {
    const range = validManifest().bridge

    expect(supportsMobileWebBridgeVersion(range, 1)).toBe(true)
    expect(supportsMobileWebBridgeVersion(range, 2)).toBe(true)
    expect(supportsMobileWebBridgeVersion(range, 0)).toBe(false)
    expect(supportsMobileWebBridgeVersion(range, 3)).toBe(false)
    expect(supportsMobileWebBridgeVersion(range, 1.5)).toBe(false)
  })

  it('serializes canonical build identity fields without buildId', () => {
    const manifest = validManifest()
    const serialized = serializeMobileWebManifestForBuildId(manifest)

    expect(serialized).not.toContain(manifest.buildId)
    expect(JSON.parse(serialized)).toEqual({
      schemaVersion: 1,
      bridge: { minimum: 1, testedThrough: 2 },
      entrypoint: 'index.html',
      totalBytes: 60,
      assets: manifest.assets
    })
  })
})
