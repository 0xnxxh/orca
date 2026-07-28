const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')
const mobileWebRoot = path.resolve(projectRoot, '..', 'src', 'mobile-web')
const disabledPageStorage = path.resolve(
  projectRoot,
  'src',
  'mobile-web',
  'disabled-page-async-storage.ts'
)

const config = getDefaultConfig(projectRoot)

// Why: mobile source-control prompts use the same pure builders as desktop.
// Metro only watches mobile/ by default, so make repo-root shared modules visible.
config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), sharedRoot, mobileWebRoot])
)
config.resolver.nodeModulesPaths = Array.from(
  new Set([...(config.resolver.nodeModulesPaths ?? []), path.resolve(projectRoot, 'node_modules')])
)
if (process.env.ORCA_EXPO_ROUTER_ROOT === 'host-web-app') {
  config.resolver.resolveRequest = (context, moduleName, platform) =>
    platform === 'web' && moduleName === '@react-native-async-storage/async-storage'
      ? { filePath: disabledPageStorage, type: 'sourceFile' }
      : context.resolveRequest(context, moduleName, platform)
}

module.exports = config
