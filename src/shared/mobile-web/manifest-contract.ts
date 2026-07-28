import { z } from 'zod'

export const MOBILE_WEB_MANIFEST_SCHEMA_VERSION = 1
export const MOBILE_WEB_PACKAGE_CHUNK_BYTES = 48 * 1024
export const MOBILE_WEB_MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MOBILE_WEB_MAX_PACKAGE_BYTES = 32 * 1024 * 1024
export const MOBILE_WEB_MAX_ASSET_COUNT = 256
export const MOBILE_WEB_MAX_PATH_CHARS = 240
export const MOBILE_WEB_MAX_BRIDGE_VERSION = 65_535

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/
const CONTENT_ADDRESSED_PATH_PATTERN = /^assets\/([a-f0-9]{64})\.(css|js|png|svg|wasm|webp|woff2)$/

const MobileWebAssetRoleSchema = z.enum(['document', 'script', 'style', 'font', 'image', 'wasm'])

const MobileWebContentTypeSchema = z.enum([
  'text/html; charset=utf-8',
  'text/javascript; charset=utf-8',
  'text/css; charset=utf-8',
  'font/woff2',
  'image/png',
  'image/svg+xml; charset=utf-8',
  'image/webp',
  'application/wasm'
])

const CONTENT_TYPE_BY_EXTENSION = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml; charset=utf-8',
  wasm: 'application/wasm',
  webp: 'image/webp',
  woff2: 'font/woff2'
} as const

const ROLE_BY_EXTENSION = {
  css: 'style',
  js: 'script',
  png: 'image',
  svg: 'image',
  wasm: 'wasm',
  webp: 'image',
  woff2: 'font'
} as const

const MobileWebAssetPathSchema = z
  .string()
  .refine(isMobileWebAssetPath, 'Asset path must be normalized and relative')

export const MobileWebAssetSchema = z
  .object({
    path: MobileWebAssetPathSchema,
    sha256: z.string().refine(isMobileWebSha256),
    byteLength: z.number().int().positive().max(MOBILE_WEB_MAX_ASSET_BYTES),
    contentType: MobileWebContentTypeSchema,
    role: MobileWebAssetRoleSchema
  })
  .strict()
  .superRefine(validateContentAddressedAsset)

const MobileWebBridgeRangeSchema = z
  .object({
    minimum: z.number().int().positive().max(MOBILE_WEB_MAX_BRIDGE_VERSION),
    testedThrough: z.number().int().positive().max(MOBILE_WEB_MAX_BRIDGE_VERSION)
  })
  .strict()
  .refine((range) => range.minimum <= range.testedThrough, {
    message: 'Bridge minimum must not exceed testedThrough',
    path: ['minimum']
  })

export const MobileWebManifestSchema = z
  .object({
    schemaVersion: z.literal(MOBILE_WEB_MANIFEST_SCHEMA_VERSION),
    buildId: z.string().refine(isMobileWebSha256),
    bridge: MobileWebBridgeRangeSchema,
    entrypoint: MobileWebAssetPathSchema,
    totalBytes: z.number().int().positive().max(MOBILE_WEB_MAX_PACKAGE_BYTES),
    assets: z.array(MobileWebAssetSchema).min(1).max(MOBILE_WEB_MAX_ASSET_COUNT)
  })
  .strict()
  .superRefine(validateManifestRelationships)

export type MobileWebAsset = z.infer<typeof MobileWebAssetSchema>
export type MobileWebManifest = z.infer<typeof MobileWebManifestSchema>
export type MobileWebBridgeRange = MobileWebManifest['bridge']

export function supportsMobileWebBridgeVersion(
  range: MobileWebBridgeRange,
  shellBridgeVersion: number
): boolean {
  return (
    Number.isInteger(shellBridgeVersion) &&
    shellBridgeVersion >= range.minimum &&
    shellBridgeVersion <= range.testedThrough
  )
}

export function isMobileWebAssetPath(path: string): boolean {
  if (
    path.length < 1 ||
    path.length > MOBILE_WEB_MAX_PATH_CHARS ||
    SAFE_PATH_PATTERN.exec(path)?.[0] !== path ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('//')
  ) {
    return false
  }
  return path.split('/').every((segment) => segment !== '.' && segment !== '..')
}

function isMobileWebSha256(value: string): boolean {
  return SHA256_PATTERN.exec(value)?.[0] === value
}

export function serializeMobileWebManifestForBuildId(manifest: MobileWebManifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    bridge: {
      minimum: manifest.bridge.minimum,
      testedThrough: manifest.bridge.testedThrough
    },
    entrypoint: manifest.entrypoint,
    totalBytes: manifest.totalBytes,
    assets: manifest.assets.map((asset) => ({
      path: asset.path,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      contentType: asset.contentType,
      role: asset.role
    }))
  })
}

function validateContentAddressedAsset(asset: MobileWebAsset, context: z.RefinementCtx): void {
  if (asset.role === 'document') {
    if (asset.path !== 'index.html' || asset.contentType !== 'text/html; charset=utf-8') {
      context.addIssue({
        code: 'custom',
        message: 'The document asset must be index.html with the HTML content type'
      })
    }
    return
  }

  const match = CONTENT_ADDRESSED_PATH_PATTERN.exec(asset.path)
  if (!match || match[1] !== asset.sha256) {
    context.addIssue({
      code: 'custom',
      message: 'Non-document asset path must contain its complete SHA-256'
    })
    return
  }
  const extension = match[2] as keyof typeof CONTENT_TYPE_BY_EXTENSION
  if (
    CONTENT_TYPE_BY_EXTENSION[extension] !== asset.contentType ||
    ROLE_BY_EXTENSION[extension] !== asset.role
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Asset extension, content type, and role must agree'
    })
  }
}

function validateManifestRelationships(
  manifest: Omit<MobileWebManifest, never>,
  context: z.RefinementCtx
): void {
  let totalBytes = 0
  let documentCount = 0
  let entrypointFound = false

  manifest.assets.forEach((asset, index) => {
    totalBytes += asset.byteLength
    documentCount += asset.role === 'document' ? 1 : 0
    entrypointFound ||= asset.path === manifest.entrypoint && asset.role === 'document'
    if (index > 0 && manifest.assets[index - 1]!.path >= asset.path) {
      context.addIssue({
        code: 'custom',
        message: 'Assets must have unique paths sorted in ascending order',
        path: ['assets', index, 'path']
      })
    }
  })

  if (documentCount !== 1 || !entrypointFound) {
    context.addIssue({
      code: 'custom',
      message: 'Manifest must contain exactly one document matching entrypoint',
      path: ['entrypoint']
    })
  }
  if (totalBytes !== manifest.totalBytes) {
    context.addIssue({
      code: 'custom',
      message: 'totalBytes must equal the sum of asset byte lengths',
      path: ['totalBytes']
    })
  }
}
