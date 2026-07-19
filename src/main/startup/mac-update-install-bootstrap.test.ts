import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mac update install startup bootstrap', () => {
  it('keeps the gate as the only static import before loading the application', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const staticImports = source.match(/^import .+$/gm) ?? []

    expect(staticImports).toEqual([
      "import { runMacUpdateInstallFenceStartupGate } from './startup/mac-update-install-fence-gate'"
    ])
    expect(source).toContain("void import('./application-main')")
    expect(source.indexOf('runMacUpdateInstallFenceStartupGate()')).toBeLessThan(
      source.indexOf("import('./application-main')")
    )
  })
})
