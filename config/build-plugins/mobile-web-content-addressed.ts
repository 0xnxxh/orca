import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { Plugin, Rolldown } from 'vite'
import { MOBILE_WEB_BRIDGE_PROTOCOL_VERSION } from '../../src/shared/mobile-web/bridge-protocol-version'
import {
  MOBILE_WEB_MANIFEST_SCHEMA_VERSION,
  MobileWebManifestSchema,
  serializeMobileWebManifestForBuildId,
  type MobileWebAsset,
  type MobileWebManifest
} from '../../src/shared/mobile-web/manifest-contract'

type OutputAsset = Rolldown.OutputAsset
type OutputBundle = Rolldown.OutputBundle
type OutputChunk = Rolldown.OutputChunk

const CONTENT_TYPE_BY_EXTENSION = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
} as const

const ROLE_BY_EXTENSION = {
  '.css': 'style',
  '.html': 'document',
  '.js': 'script',
  '.png': 'image',
  '.svg': 'image',
  '.wasm': 'wasm',
  '.webp': 'image',
  '.woff2': 'font'
} as const

export function createMobileWebContentAddressedPlugin(): Plugin {
  return {
    name: 'orca-mobile-web-content-addressed',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entryChunks = Object.values(bundle).filter(
        (item): item is OutputChunk => item.type === 'chunk' && item.isEntry
      )
      if (entryChunks.length !== 1 || entryChunks[0]!.imports.length > 0) {
        this.error('Mobile web build must emit one self-contained entry chunk')
      }
      if (entryChunks[0]!.dynamicImports.length > 0) {
        this.error('Mobile web build cannot emit runtime-loaded JavaScript chunks')
      }

      const renames = new Map<string, string>()
      const binaryAssets = Object.values(bundle).filter(
        (item): item is OutputAsset =>
          item.type === 'asset' && !['.css', '.html'].includes(posix.extname(item.fileName))
      )
      for (const asset of binaryAssets) {
        renameContentAddressedAsset(bundle, asset, assetBytes(asset), renames)
      }

      const styles = Object.values(bundle).filter(
        (item): item is OutputAsset =>
          item.type === 'asset' && posix.extname(item.fileName) === '.css'
      )
      for (const style of styles) {
        style.source = replaceAssetReferences(String(style.source), renames)
        renameContentAddressedAsset(bundle, style, assetBytes(style), renames)
      }

      const entry = entryChunks[0]!
      entry.code = replaceAssetReferences(entry.code, renames)
      renameContentAddressedChunk(bundle, entry, renames)

      const document = Object.values(bundle).find(
        (item): item is OutputAsset => item.type === 'asset' && item.fileName === 'index.html'
      )
      if (!document) {
        this.error('Mobile web build did not emit index.html')
      }
      document.source = replaceAssetReferences(String(document.source), renames)

      const assets = manifestAssets(bundle)
      const manifestWithoutIdentity: MobileWebManifest = {
        schemaVersion: MOBILE_WEB_MANIFEST_SCHEMA_VERSION,
        buildId: '0'.repeat(64),
        bridge: {
          minimum: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
          testedThrough: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION
        },
        entrypoint: 'index.html',
        totalBytes: assets.reduce((total, asset) => total + asset.byteLength, 0),
        assets
      }
      const manifest = MobileWebManifestSchema.parse({
        ...manifestWithoutIdentity,
        buildId: sha256(serializeMobileWebManifestForBuildId(manifestWithoutIdentity))
      })
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`
      })
    }
  }
}

function renameContentAddressedAsset(
  bundle: OutputBundle,
  asset: OutputAsset,
  bytes: Uint8Array,
  renames: Map<string, string>
): void {
  const extension = posix.extname(asset.fileName)
  const nextName = `assets/${sha256(bytes)}${extension}`
  renameBundleItem(bundle, asset.fileName, nextName, asset, renames)
}

function renameContentAddressedChunk(
  bundle: OutputBundle,
  chunk: OutputChunk,
  renames: Map<string, string>
): void {
  const nextName = `assets/${sha256(chunk.code)}.js`
  renameBundleItem(bundle, chunk.fileName, nextName, chunk, renames)
}

function renameBundleItem(
  bundle: OutputBundle,
  oldName: string,
  nextName: string,
  item: OutputAsset | OutputChunk,
  renames: Map<string, string>
): void {
  if (bundle[nextName]) {
    throw new Error(`Duplicate mobile web content-addressed path: ${nextName}`)
  }
  delete bundle[oldName]
  item.fileName = nextName
  bundle[nextName] = item
  renames.set(oldName, nextName)
}

function replaceAssetReferences(source: string, renames: ReadonlyMap<string, string>): string {
  let output = source
  for (const [oldName, nextName] of renames) {
    output = output.replaceAll(oldName, nextName)
    output = output.replaceAll(posix.basename(oldName), posix.basename(nextName))
  }
  return output
}

function manifestAssets(bundle: OutputBundle): MobileWebAsset[] {
  return Object.values(bundle)
    .filter((item) => item.fileName !== 'manifest.json')
    .map((item) => {
      const extension = posix.extname(item.fileName) as keyof typeof CONTENT_TYPE_BY_EXTENSION
      const contentType = CONTENT_TYPE_BY_EXTENSION[extension]
      const role = ROLE_BY_EXTENSION[extension]
      if (!contentType || !role) {
        throw new Error(`Unsupported mobile web asset type: ${item.fileName}`)
      }
      const bytes = item.type === 'chunk' ? new TextEncoder().encode(item.code) : assetBytes(item)
      return {
        path: item.fileName,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        contentType,
        role
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

function assetBytes(asset: OutputAsset): Uint8Array {
  return typeof asset.source === 'string'
    ? new TextEncoder().encode(asset.source)
    : new Uint8Array(asset.source)
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
