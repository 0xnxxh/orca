import type { RuntimeConnectivityStartupCapability } from './runtime-connectivity-startup-capability'

let capability: RuntimeConnectivityStartupCapability | null = null

export function installRuntimeConnectivityStartupCapability(
  nextCapability: RuntimeConnectivityStartupCapability
): void {
  capability = nextCapability
}

export function getRuntimeConnectivityStartupCapability(): RuntimeConnectivityStartupCapability {
  if (!capability) {
    throw new Error('Runtime connectivity capability must be initialized before use')
  }
  return capability
}
