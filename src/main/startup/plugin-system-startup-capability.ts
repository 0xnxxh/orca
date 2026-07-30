import type { KeybindingOverrides } from '../../shared/keybindings'
import {
  normalizePluginConsents,
  normalizePluginIdList
} from '../../shared/plugins/plugin-consent-state'
import type { PluginKillListEntry } from '../../shared/plugins/plugin-kill-list'
import type { GlobalSettings } from '../../shared/types'
import { resolveBundledPluginRoot } from '../plugins/plugin-bundled-bootstrap'
import { PluginBundledBootstrapCoordinator } from '../plugins/plugin-bundled-bootstrap-coordinator'
import { getPluginsDataDir } from '../plugins/plugin-discovery'
import { resolvePluginHostEntryPath } from '../plugins/plugin-host-process'
import { PluginKillListService } from '../plugins/plugin-kill-list-service'
import { PluginMarketplaceInstaller } from '../plugins/plugin-marketplace-installer'
import { PluginMarketplaceService } from '../plugins/plugin-marketplace-service'
import { PluginService } from '../plugins/plugin-service'

type PluginStartupSettings = Pick<
  GlobalSettings,
  'pluginSystemEnabled' | 'disabledPlugins' | 'pluginConsents' | 'devPluginPaths'
>

type PluginSystemStartupPlatform = {
  userDataPath: string
  hostVersion: string
  appPath: string
  resourcesPath: string
  isPackaged: boolean
}

type PluginSystemStartupBindings = {
  getSettings: () => PluginStartupSettings
  getKeybindings: () => KeybindingOverrides
  getKillListEntry: (pluginKey: string) => PluginKillListEntry | null
  getBlockedPluginReason: (pluginKey: string) => string | null
  refreshPlugins: () => Promise<void>
}

export type PluginSystemStartupCapability = {
  killList: PluginKillListService
  marketplace: PluginMarketplaceService
  marketplaceInstaller: PluginMarketplaceInstaller
  pluginService: PluginService
  bundledBootstrap: PluginBundledBootstrapCoordinator
}

export async function createPluginSystemStartupCapability(
  platform: PluginSystemStartupPlatform,
  bindings: PluginSystemStartupBindings
): Promise<PluginSystemStartupCapability> {
  const killList = new PluginKillListService({
    pluginsDataDir: getPluginsDataDir(platform.userDataPath)
  })
  await killList.initialize()
  const marketplace = new PluginMarketplaceService({
    pluginsDataDir: getPluginsDataDir(platform.userDataPath),
    getKillListEntry: bindings.getKillListEntry
  })
  const marketplaceInstaller = new PluginMarketplaceInstaller({
    marketplace,
    userDataPath: platform.userDataPath,
    hostVersion: platform.hostVersion,
    blockedPluginReason: bindings.getBlockedPluginReason
  })
  const pluginService = new PluginService({
    userDataPath: platform.userDataPath,
    hostVersion: platform.hostVersion,
    isPluginSystemEnabled: () => bindings.getSettings().pluginSystemEnabled === true,
    getDisabledPlugins: () => normalizePluginIdList(bindings.getSettings().disabledPlugins),
    getPluginConsents: () => normalizePluginConsents(bindings.getSettings().pluginConsents),
    getDevPluginPaths: () => normalizePluginIdList(bindings.getSettings().devPluginPaths),
    getKeybindings: bindings.getKeybindings,
    getPluginKillListEntry: bindings.getKillListEntry,
    hostEntryPath: resolvePluginHostEntryPath(platform.appPath, platform.isPackaged)
  })
  const bundledBootstrap = new PluginBundledBootstrapCoordinator({
    root: resolveBundledPluginRoot({
      isPackaged: platform.isPackaged,
      resourcesPath: platform.resourcesPath,
      appPath: platform.appPath
    }),
    userDataPath: platform.userDataPath,
    hostVersion: platform.hostVersion,
    isEnabled: () => bindings.getSettings().pluginSystemEnabled === true,
    blockedPluginReason: bindings.getBlockedPluginReason,
    refreshPlugins: bindings.refreshPlugins
  })

  return { killList, marketplace, marketplaceInstaller, pluginService, bundledBootstrap }
}
