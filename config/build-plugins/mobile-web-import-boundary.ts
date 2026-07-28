import { isAbsolute, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

const MOBILE_WEB_ROOT = resolve('src/mobile-web')
const SHARED_ROOT = resolve('src/shared')
const SOURCE_ROOT = resolve('src')
const APPROVED_RENDERER_ROOTS = [
  resolve('src/renderer/src/assets'),
  resolve('src/renderer/src/components/ui'),
  resolve('src/renderer/src/lib/utils.ts')
]

export function createMobileWebImportBoundaryPlugin(): Plugin {
  return {
    name: 'orca-mobile-web-import-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      const violation = mobileWebImportBoundaryViolation(source, importer)
      if (violation) {
        this.error(violation)
      }
      return null
    }
  }
}

export function mobileWebImportBoundaryViolation(
  source: string,
  importer: string | undefined
): string | null {
  if (!importer || importer.includes('node_modules')) {
    return null
  }
  if (source === 'electron' || source.startsWith('node:') || source.startsWith('@electron')) {
    return `Mobile web code cannot import ${source}`
  }
  const resolved = resolveSourcePath(source, importer)
  if (!resolved || isInside(resolved, MOBILE_WEB_ROOT) || isInside(resolved, SHARED_ROOT)) {
    return null
  }
  if (APPROVED_RENDERER_ROOTS.some((root) => isApprovedRendererImport(resolved, root))) {
    return null
  }
  return isInside(resolved, SOURCE_ROOT)
    ? `Mobile web import crosses its approved boundary: ${source}`
    : null
}

function isApprovedRendererImport(candidate: string, root: string): boolean {
  return isInside(candidate, root) || candidate === root.replace(/\.(?:ts|tsx)$/, '')
}

function resolveSourcePath(source: string, importer: string): string | null {
  if (source.startsWith('@renderer/')) {
    return resolve('src/renderer/src', source.slice('@renderer/'.length))
  }
  if (source.startsWith('@/')) {
    return resolve('src/renderer/src', source.slice(2))
  }
  if (source.startsWith('.')) {
    return resolve(importer, '..', source)
  }
  return null
}

function isInside(candidate: string, root: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}
