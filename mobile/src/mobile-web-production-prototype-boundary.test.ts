import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const productionRoots = [
  new URL('../app/hybrid.tsx', import.meta.url),
  new URL('./mobile-web', import.meta.url),
  new URL('../host-web-app', import.meta.url),
  new URL('../../src/mobile-web', import.meta.url),
  new URL('../../src/shared/mobile-web', import.meta.url),
  new URL('../../src/main/runtime/rpc/methods/mobile-web-package.ts', import.meta.url),
  new URL('../../src/main/runtime/rpc/mobile-web-package-assets.ts', import.meta.url),
  new URL('../../src/main/runtime/rpc/mobile-web-package-root.ts', import.meta.url)
]

const forbiddenProductionReferences = [
  'hybrid-prototype',
  'mobile-web-prototype',
  'MobileWebPrototype',
  'mobileWeb.prototype'
]

function sourceFiles(root: URL): URL[] {
  if (extname(root.pathname)) {
    return [root]
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${root.href.replace(/\/$/, '')}/${entry.name}`)
    if (entry.isDirectory()) {
      return sourceFiles(child)
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : []
  })
}

describe('mobile web production prototype boundary', () => {
  it('keeps prototype contracts and names out of production sources', () => {
    const violations = productionRoots.flatMap(sourceFiles).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return forbiddenProductionReferences
        .filter((reference) => source.includes(reference))
        .map((reference) => `${join(...file.pathname.split('/').slice(-4))}: ${reference}`)
    })

    expect(violations).toEqual([])
  })
})
