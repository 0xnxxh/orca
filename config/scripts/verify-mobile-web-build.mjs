import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  MobileWebManifestSchema,
  serializeMobileWebManifestForBuildId
} from '../../src/shared/mobile-web/manifest-contract.ts'

const outputRoot = path.resolve('out/mobile-web')
const maxUncompressedBytes = 2 * 1024 * 1024
const maxCompressedBytes = 512 * 1024
const maxScriptBytes = 1024 * 1024
const maxStyleBytes = 256 * 1024
const manifestPath = path.join(outputRoot, 'manifest.json')
const manifest = MobileWebManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))

const expectedBuildId = sha256(serializeMobileWebManifestForBuildId(manifest))
if (manifest.buildId !== expectedBuildId) {
  throw new Error('Mobile web manifest buildId does not match canonical manifest content')
}

const assetBytes = new Map()
for (const asset of manifest.assets) {
  const bytes = await readFile(path.join(outputRoot, ...asset.path.split('/')))
  assetBytes.set(asset.path, bytes)
  if (bytes.byteLength !== asset.byteLength) {
    throw new Error(`Mobile web asset length mismatch: ${asset.path}`)
  }
  if (sha256(bytes) !== asset.sha256) {
    throw new Error(`Mobile web asset hash mismatch: ${asset.path}`)
  }
}

const scriptBytes = manifest.assets
  .filter((asset) => asset.role === 'script')
  .reduce((total, asset) => total + asset.byteLength, 0)
const styleBytes = manifest.assets
  .filter((asset) => asset.role === 'style')
  .reduce((total, asset) => total + asset.byteLength, 0)
const compressedBytes = manifest.assets
  .map((asset) => gzipSync(assetBytes.get(asset.path)))
  .reduce((total, bytes) => total + bytes.byteLength, 0)
if (
  manifest.totalBytes > maxUncompressedBytes ||
  compressedBytes > maxCompressedBytes ||
  scriptBytes > maxScriptBytes ||
  styleBytes > maxStyleBytes
) {
  throw new Error(
    `Mobile web bundle exceeds budget: total=${manifest.totalBytes}, compressed=${compressedBytes}, script=${scriptBytes}, style=${styleBytes}`
  )
}

const actualPaths = (await listFiles(outputRoot)).filter((file) => file !== 'manifest.json').sort()
const declaredPaths = manifest.assets.map((asset) => asset.path)
if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
  throw new Error('Mobile web output contains undeclared or missing assets')
}

const html = await readFile(path.join(outputRoot, 'index.html'), 'utf8')
const requiredCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
]
for (const directive of requiredCsp) {
  if (!html.includes(directive)) {
    throw new Error(`Mobile web CSP is missing: ${directive}`)
  }
}

for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
  const reference = match[1]
  if (!reference?.startsWith('./assets/')) {
    throw new Error(`Mobile web document contains a non-relative asset reference: ${reference}`)
  }
  if (!declaredPaths.includes(reference.slice(2))) {
    throw new Error(`Mobile web document references an undeclared asset: ${reference}`)
  }
}

for (const asset of manifest.assets.filter((candidate) => candidate.role === 'script')) {
  const source = await readFile(path.join(outputRoot, ...asset.path.split('/')), 'utf8')
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
    throw new Error(`Mobile web executable asset contains runtime code generation: ${asset.path}`)
  }
  if (/sourceMappingURL/.test(source)) {
    throw new Error(`Mobile web executable asset contains a source map reference: ${asset.path}`)
  }
}

const styles = manifest.assets
  .filter((asset) => asset.role === 'style')
  .map((asset) => assetBytes.get(asset.path).toString('utf8'))
  .join('\n')
const requiredDialogStyles = [
  /\.fixed\{position:fixed\}/,
  /\.inset-0\{inset:calc\(var\(--spacing\)\s*\*\s*0\)\}/,
  /\.top-\\\[50\\%\\\]\{top:50%\}/,
  /\.left-\\\[50\\%\\\]\{left:50%\}/,
  /\.translate-x-\\\[-50\\%\\\]\{[^}]*--tw-translate-x:-50%/,
  /\.translate-y-\\\[-50\\%\\\]\{[^}]*--tw-translate-y:-50%/,
  /\.max-w-\\\[calc\\\(100\\%-2rem\\\)\\\]\{max-width:calc\(100% - 2rem\)\}/,
  /\.z-50\{z-index:50\}/
]
for (const requiredStyle of requiredDialogStyles) {
  if (!requiredStyle.test(styles)) {
    throw new Error(`Mobile web styles are missing dialog utility: ${requiredStyle}`)
  }
}

console.log(
  `Mobile web build verified: ${manifest.assets.length} assets, ${manifest.totalBytes} bytes (${compressedBytes} compressed), build ${manifest.buildId}`
)

async function listFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, child)))
    } else {
      files.push(child.split(path.sep).join('/'))
    }
  }
  return files
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
