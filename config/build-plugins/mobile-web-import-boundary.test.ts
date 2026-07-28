import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mobileWebImportBoundaryViolation } from './mobile-web-import-boundary'

const MOBILE_IMPORTER = resolve('src/mobile-web/src/mobile-web-shell.tsx')
const CARD_IMPORTER = resolve('src/renderer/src/components/ui/card.tsx')

describe('mobile web import boundary', () => {
  it.each([
    ['./mobile-web-shell', MOBILE_IMPORTER],
    ['../../shared/mobile-web/bridge-contract', MOBILE_IMPORTER],
    ['@renderer/components/ui/card', MOBILE_IMPORTER],
    ['@/lib/utils', CARD_IMPORTER],
    ['react', MOBILE_IMPORTER]
  ])('allows approved import %s', (source, importer) => {
    expect(mobileWebImportBoundaryViolation(source, importer)).toBeNull()
  })

  it.each([
    ['electron', MOBILE_IMPORTER],
    ['node:fs', MOBILE_IMPORTER],
    ['@electron-toolkit/preload', MOBILE_IMPORTER],
    ['../../main/index', MOBILE_IMPORTER],
    ['../../preload/index', MOBILE_IMPORTER],
    ['@renderer/App', MOBILE_IMPORTER],
    ['@/store', CARD_IMPORTER]
  ])('rejects desktop or native import %s', (source, importer) => {
    expect(mobileWebImportBoundaryViolation(source, importer)).not.toBeNull()
  })
})
