import { z } from 'zod'
import {
  MOBILE_WEB_MAX_PATH_CHARS,
  MOBILE_WEB_PACKAGE_CHUNK_BYTES,
  MobileWebManifestSchema
} from './manifest-contract'

export const MOBILE_WEB_PACKAGE_MAX_CONCURRENT_READS = 4
export const MOBILE_WEB_PACKAGE_MAX_IN_FLIGHT_BYTES =
  MOBILE_WEB_PACKAGE_MAX_CONCURRENT_READS * MOBILE_WEB_PACKAGE_CHUNK_BYTES
export const MOBILE_WEB_PACKAGE_CHUNK_BASE64_CHARS =
  Math.ceil(MOBILE_WEB_PACKAGE_CHUNK_BYTES / 3) * 4

export const MOBILE_WEB_PACKAGE_ERROR_CODES = [
  'mobile_web_package_unavailable',
  'mobile_web_package_build_changed',
  'mobile_web_package_build_invalid',
  'mobile_web_package_asset_unknown',
  'mobile_web_package_asset_invalid',
  'mobile_web_package_asset_changed',
  'mobile_web_package_asset_truncated',
  'mobile_web_package_asset_path_invalid',
  'mobile_web_package_offset_invalid',
  'mobile_web_package_read_limited',
  'mobile_web_package_cancelled'
] as const

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const AssetPathSchema = z
  .string()
  .min(1)
  .max(MOBILE_WEB_MAX_PATH_CHARS)
  .regex(SAFE_PATH_PATTERN)
  .refine(isNormalizedAssetPath, 'Asset path must be normalized and relative')

export const MobileWebPackageManifestResponseSchema = z
  .object({
    manifest: MobileWebManifestSchema,
    chunkBytes: z.literal(MOBILE_WEB_PACKAGE_CHUNK_BYTES)
  })
  .strict()

export const MobileWebPackageAssetParamsSchema = z
  .object({
    buildId: z.string().regex(SHA256_PATTERN),
    path: AssetPathSchema,
    offset: z.number().int().nonnegative()
  })
  .strict()

export const MobileWebPackageAssetChunkSchema = z
  .object({
    buildId: z.string().regex(SHA256_PATTERN),
    path: AssetPathSchema,
    offset: z.number().int().nonnegative(),
    byteLength: z.number().int().positive().max(MOBILE_WEB_PACKAGE_CHUNK_BYTES),
    sha256: z.string().regex(SHA256_PATTERN),
    dataBase64: z.string().min(4).max(MOBILE_WEB_PACKAGE_CHUNK_BASE64_CHARS).regex(BASE64_PATTERN),
    eof: z.boolean()
  })
  .strict()
  .superRefine((chunk, context) => {
    if (decodedBase64Length(chunk.dataBase64) !== chunk.byteLength) {
      context.addIssue({ code: 'custom', message: 'Chunk byte length must match base64 data' })
    }
  })

export type MobileWebPackageManifestResponse = z.infer<
  typeof MobileWebPackageManifestResponseSchema
>
export type MobileWebPackageAssetParams = z.infer<typeof MobileWebPackageAssetParamsSchema>
export type MobileWebPackageAssetChunk = z.infer<typeof MobileWebPackageAssetChunkSchema>
export type MobileWebPackageErrorCode = (typeof MOBILE_WEB_PACKAGE_ERROR_CODES)[number]

const MOBILE_WEB_PACKAGE_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  MOBILE_WEB_PACKAGE_ERROR_CODES
)

export function isMobileWebPackageErrorCode(value: string): value is MobileWebPackageErrorCode {
  return MOBILE_WEB_PACKAGE_ERROR_CODE_SET.has(value)
}

function isNormalizedAssetPath(path: string): boolean {
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    return false
  }
  return path.split('/').every((segment) => segment !== '.' && segment !== '..')
}

function decodedBase64Length(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}
