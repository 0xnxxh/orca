import type { ShutdownWatcherRuntimeMetadataStartupCapability } from './shutdown-watcher-runtime-metadata-startup-capability'

let capability: ShutdownWatcherRuntimeMetadataStartupCapability | null = null

export function installShutdownWatcherRuntimeMetadataStartupCapability(
  nextCapability: ShutdownWatcherRuntimeMetadataStartupCapability
): void {
  capability = nextCapability
}

export function getShutdownWatcherRuntimeMetadataStartupCapability(): ShutdownWatcherRuntimeMetadataStartupCapability {
  if (!capability) {
    throw new Error('Shutdown watcher/runtime-metadata capability must be initialized before use')
  }
  return capability
}

export function getShutdownWatcherRuntimeMetadataStartupCapabilityIfInstalled(): ShutdownWatcherRuntimeMetadataStartupCapability | null {
  return capability
}
