import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/keybinding-service-startup-capability')"
const capabilityFactory = 'keybindings = await createKeybindingServiceStartupCapability({'

describe('keybinding service startup boundary', () => {
  it('keeps the service implementation out of the eager main graph', () => {
    const serviceImport = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .find(
        (declaration) =>
          (declaration.moduleSpecifier as ts.StringLiteral).text ===
          './keybindings/keybinding-service'
      )

    expect(serviceImport?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new KeybindingService(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('completes construction before settings resolution and observable readiness', () => {
    const importIndex = source.indexOf(capabilityImport)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const factoryEndIndex = source.indexOf('browserManager.setSettingsResolver', factoryIndex)
    const pluginIndex = source.indexOf('pluginService = new PluginService', factoryEndIndex)
    const initializedIndex = source.indexOf(
      "logStartupMilestone('services-initialized')",
      pluginIndex
    )

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(factoryEndIndex).toBeGreaterThan(factoryIndex)
    expect(pluginIndex).toBeGreaterThan(factoryEndIndex)
    expect(initializedIndex).toBeGreaterThan(pluginIndex)
  })

  it('preserves constructor inputs and later service consumers', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const resolverIndex = source.indexOf('browserManager.setSettingsResolver', factoryIndex)
    const constructorSource = source.slice(factoryIndex, resolverIndex)

    expect(constructorSource).toContain("homePath: app.getPath('home')")
    expect(constructorSource).toContain(
      'getLegacyOverrides: () => store!.getSettings().keybindings'
    )
    expect(constructorSource).toContain(
      "isPending: () => store!.getSettings().tabSwitchKeybindingSeed === 'pending'"
    )
    expect(constructorSource).toContain(
      "store!.updateSettings({ tabSwitchKeybindingSeed: 'done' })"
    )
    expect(source).toContain('getKeybindings: () => keybindings?.getOverrides()')
    expect(source).toContain('keybindings,')
    expect(source).toContain('getKeybindings: () => keybindings?.getOverrides() ?? {}')
    expect(source).toContain(
      "throw new Error('Keybinding service must be initialized before opening the main window')"
    )
  })
})
