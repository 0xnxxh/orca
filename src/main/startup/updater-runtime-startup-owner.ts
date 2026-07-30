import type { UpdaterRuntimeStartupCapability } from './updater-runtime-startup-capability'

let capability: UpdaterRuntimeStartupCapability | null = null

export function installUpdaterRuntimeStartupCapability(
  nextCapability: UpdaterRuntimeStartupCapability
): void {
  capability = nextCapability
}

export function getUpdaterRuntimeStartupCapability(): UpdaterRuntimeStartupCapability {
  if (!capability) {
    throw new Error('Updater-runtime capability must be initialized before use')
  }
  return capability
}
