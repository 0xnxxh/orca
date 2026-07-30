import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  events: [] as string[],
  killListConstructor: vi.fn(),
  marketplaceConstructor: vi.fn(),
  installerConstructor: vi.fn(),
  pluginServiceConstructor: vi.fn(),
  bundledBootstrapConstructor: vi.fn()
}))

vi.mock('../plugins/plugin-discovery', () => ({
  getPluginsDataDir: (userDataPath: string) => join(userDataPath, 'plugins-data')
}))

vi.mock('../plugins/plugin-host-process', () => ({
  resolvePluginHostEntryPath: (appPath: string, isPackaged: boolean) =>
    join(appPath, `${isPackaged ? 'packaged' : 'development'}-plugin-host.js`)
}))

vi.mock('../plugins/plugin-bundled-bootstrap', () => ({
  resolveBundledPluginRoot: (options: {
    isPackaged: boolean
    resourcesPath: string
    appPath: string
  }) => join(options.isPackaged ? options.resourcesPath : options.appPath, 'bundled-plugins')
}))

vi.mock('../plugins/plugin-kill-list-service', () => ({
  PluginKillListService: class {
    constructor(options: unknown) {
      serviceMocks.events.push('kill-list')
      serviceMocks.killListConstructor(this, options)
    }

    async initialize(): Promise<void> {
      serviceMocks.events.push('kill-list-initialize')
    }
  }
}))

vi.mock('../plugins/plugin-marketplace-service', () => ({
  PluginMarketplaceService: class {
    constructor(options: unknown) {
      serviceMocks.events.push('marketplace')
      serviceMocks.marketplaceConstructor(this, options)
    }
  }
}))

vi.mock('../plugins/plugin-marketplace-installer', () => ({
  PluginMarketplaceInstaller: class {
    constructor(options: unknown) {
      serviceMocks.events.push('marketplace-installer')
      serviceMocks.installerConstructor(this, options)
    }
  }
}))

vi.mock('../plugins/plugin-service', () => ({
  PluginService: class {
    constructor(options: unknown) {
      serviceMocks.events.push('plugin-service')
      serviceMocks.pluginServiceConstructor(this, options)
    }
  }
}))

vi.mock('../plugins/plugin-bundled-bootstrap-coordinator', () => ({
  PluginBundledBootstrapCoordinator: class {
    constructor(options: unknown) {
      serviceMocks.events.push('bundled-bootstrap')
      serviceMocks.bundledBootstrapConstructor(this, options)
    }
  }
}))

import type { GlobalSettings } from '../../shared/types'
import { createPluginSystemStartupCapability } from './plugin-system-startup-capability'

const platform = {
  userDataPath: join('profile', 'user-data'),
  hostVersion: '1.2.3',
  appPath: join('application', 'root'),
  resourcesPath: join('application', 'resources'),
  isPackaged: true
}

function createBindings(settings: Partial<GlobalSettings> = {}) {
  return {
    getSettings: () =>
      ({
        pluginSystemEnabled: true,
        disabledPlugins: [],
        pluginConsents: {},
        devPluginPaths: [],
        ...settings
      }) as GlobalSettings,
    getKeybindings: vi.fn(() => ({ 'app.newTerminal': ['CmdOrCtrl+T'] })),
    getKillListEntry: vi.fn(() => null),
    getBlockedPluginReason: vi.fn(() => null),
    refreshPlugins: vi.fn(async () => undefined)
  }
}

describe('plugin system startup capability', () => {
  beforeEach(() => {
    serviceMocks.events.length = 0
    vi.clearAllMocks()
  })

  it('preserves the kill-list barrier and exact aggregate construction order', async () => {
    const services = await createPluginSystemStartupCapability(platform, createBindings())

    expect(serviceMocks.events).toEqual([
      'kill-list',
      'kill-list-initialize',
      'marketplace',
      'marketplace-installer',
      'plugin-service',
      'bundled-bootstrap'
    ])
    expect(serviceMocks.killListConstructor).toHaveBeenCalledWith(services.killList, {
      pluginsDataDir: join(platform.userDataPath, 'plugins-data')
    })
    expect(serviceMocks.marketplaceConstructor.mock.calls[0]?.[0]).toBe(services.marketplace)
    expect(serviceMocks.installerConstructor.mock.calls[0]?.[0]).toBe(services.marketplaceInstaller)
    expect(serviceMocks.pluginServiceConstructor.mock.calls[0]?.[0]).toBe(services.pluginService)
    expect(serviceMocks.bundledBootstrapConstructor.mock.calls[0]?.[0]).toBe(
      services.bundledBootstrap
    )
  })

  it('preserves platform values, dependency identity, and live policy callbacks', async () => {
    const bindings = createBindings({
      disabledPlugins: ['official.one', 'official.one'],
      pluginConsents: { 'official.one': 'fingerprint' },
      devPluginPaths: ['/dev/plugin', '/dev/plugin']
    })
    const services = await createPluginSystemStartupCapability(platform, bindings)
    const marketplaceOptions = serviceMocks.marketplaceConstructor.mock.calls[0]?.[1]
    const installerOptions = serviceMocks.installerConstructor.mock.calls[0]?.[1]
    const pluginOptions = serviceMocks.pluginServiceConstructor.mock.calls[0]?.[1]
    const bootstrapOptions = serviceMocks.bundledBootstrapConstructor.mock.calls[0]?.[1]

    expect(marketplaceOptions).toMatchObject({
      pluginsDataDir: join(platform.userDataPath, 'plugins-data'),
      getKillListEntry: bindings.getKillListEntry
    })
    expect(installerOptions).toMatchObject({
      marketplace: services.marketplace,
      userDataPath: platform.userDataPath,
      hostVersion: '1.2.3',
      blockedPluginReason: bindings.getBlockedPluginReason
    })
    expect(pluginOptions).toMatchObject({
      userDataPath: platform.userDataPath,
      hostVersion: '1.2.3',
      getKeybindings: bindings.getKeybindings,
      getPluginKillListEntry: bindings.getKillListEntry,
      hostEntryPath: join(platform.appPath, 'packaged-plugin-host.js')
    })
    expect(pluginOptions.isPluginSystemEnabled()).toBe(true)
    expect(pluginOptions.getDisabledPlugins()).toEqual(['official.one'])
    expect(pluginOptions.getPluginConsents()).toEqual({ 'official.one': 'fingerprint' })
    expect(pluginOptions.getDevPluginPaths()).toEqual(['/dev/plugin'])
    expect(bootstrapOptions).toMatchObject({
      root: join(platform.resourcesPath, 'bundled-plugins'),
      userDataPath: platform.userDataPath,
      hostVersion: '1.2.3',
      blockedPluginReason: bindings.getBlockedPluginReason,
      refreshPlugins: bindings.refreshPlugins
    })
    expect(bootstrapOptions.isEnabled()).toBe(true)
  })
})
