import { describe, expect, it } from 'vitest'
import {
  MobileWebPackageAssetChunkSchema,
  MobileWebPackageAssetParamsSchema
} from './package-rpc-contract'

const BUILD_ID = 'a'.repeat(64)

describe('mobile web package RPC contract', () => {
  it('accepts a normalized asset request and exact chunk response', () => {
    expect(
      MobileWebPackageAssetParamsSchema.safeParse({
        buildId: BUILD_ID,
        path: `assets/${'b'.repeat(64)}.js`,
        offset: 0
      }).success
    ).toBe(true)
    expect(
      MobileWebPackageAssetChunkSchema.safeParse({
        buildId: BUILD_ID,
        path: 'index.html',
        offset: 0,
        byteLength: 3,
        sha256: 'c'.repeat(64),
        dataBase64: Buffer.from('abc').toString('base64'),
        eof: true
      }).success
    ).toBe(true)
  })

  it.each(['../secret', '/index.html', 'assets//app.js', 'assets\\app.js', 'a%2Fb.js'])(
    'rejects unsafe request path %s',
    (path) => {
      expect(
        MobileWebPackageAssetParamsSchema.safeParse({ buildId: BUILD_ID, path, offset: 0 }).success
      ).toBe(false)
    }
  )

  it('rejects unknown request fields, invalid base64, and mismatched decoded length', () => {
    expect(
      MobileWebPackageAssetParamsSchema.safeParse({
        buildId: BUILD_ID,
        path: 'index.html',
        offset: 0,
        filesystemPath: '/private/package/index.html'
      }).success
    ).toBe(false)
    const chunk = {
      buildId: BUILD_ID,
      path: 'index.html',
      offset: 0,
      byteLength: 3,
      sha256: 'c'.repeat(64),
      dataBase64: Buffer.from('abc').toString('base64'),
      eof: true
    }
    expect(
      MobileWebPackageAssetChunkSchema.safeParse({ ...chunk, dataBase64: '***=' }).success
    ).toBe(false)
    expect(MobileWebPackageAssetChunkSchema.safeParse({ ...chunk, byteLength: 4 }).success).toBe(
      false
    )
  })
})
