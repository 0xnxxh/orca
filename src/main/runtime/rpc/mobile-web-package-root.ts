import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

type MobileWebPackageRootOptions = {
  cwd?: string
  overrideRoot?: string
  resourcesPath?: string
}

export function resolveMobileWebPackageRoot(options: MobileWebPackageRootOptions = {}): string {
  const overrideRoot = options.overrideRoot ?? process.env.ORCA_MOBILE_WEB_PACKAGE_ROOT
  const resourcesPath =
    options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    overrideRoot ? resolve(overrideRoot) : null,
    resourcesPath ? join(resourcesPath, 'mobile-web') : null,
    resolve(options.cwd ?? process.cwd(), 'out', 'mobile-web-rnw')
  ].filter((candidate): candidate is string => candidate !== null)

  const root = candidates.find((candidate) => existsSync(join(candidate, 'manifest.json')))
  if (!root) {
    throw new Error('mobile_web_package_unavailable')
  }
  return root
}
