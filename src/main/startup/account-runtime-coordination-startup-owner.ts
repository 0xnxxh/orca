import type { AccountRuntimeCoordinationStartupCapability } from './account-runtime-coordination-startup-capability'

let capability: AccountRuntimeCoordinationStartupCapability | null = null

export function installAccountRuntimeCoordinationStartupCapability(
  nextCapability: AccountRuntimeCoordinationStartupCapability
): void {
  capability = nextCapability
}

export function getAccountRuntimeCoordinationStartupCapability(): AccountRuntimeCoordinationStartupCapability {
  if (!capability) {
    throw new Error('Account-runtime coordination capability must be initialized before use')
  }
  return capability
}
