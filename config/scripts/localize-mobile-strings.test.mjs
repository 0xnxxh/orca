import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { main as localizeMobileStrings } from './localize-mobile-strings.mjs'

function makeProject() {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-localize-mobile-strings-'))
  const appDirectory = path.join(root, 'mobile', 'app')
  const sourceDirectory = path.join(root, 'mobile', 'src')
  const localeDirectory = path.join(sourceDirectory, 'i18n', 'locales')
  mkdirSync(appDirectory, { recursive: true })
  mkdirSync(localeDirectory, { recursive: true })
  writeFileSync(path.join(localeDirectory, 'en.json'), '{}\n', 'utf8')
  return { root, appDirectory, localeDirectory }
}

describe('localize-mobile-strings', () => {
  it('decodes JSX entities case-insensitively without changing JavaScript string literals', async () => {
    const { root, appDirectory, localeDirectory } = makeProject()
    writeFileSync(path.join(appDirectory, 'Literal.ts'), "export const label = 'Use &amp; here'\n")
    writeFileSync(
      path.join(appDirectory, 'Rendered.tsx'),
      'export function Rendered() { return <Text>Use &AMP; here</Text> }\n'
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await expect(localizeMobileStrings(root)).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }

    const catalog = JSON.parse(readFileSync(path.join(localeDirectory, 'en.json'), 'utf8'))
    expect(Object.values(catalog.m)).toEqual(
      expect.arrayContaining(['Use &amp; here', 'Use & here'])
    )
  })
})
