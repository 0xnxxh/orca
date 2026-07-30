import { registerCoreHandlers } from '../ipc/register-core-handlers'

export type CoreIpcRegistry = typeof registerCoreHandlers

export function getCoreIpcRegistryStartupCapability(): CoreIpcRegistry {
  return registerCoreHandlers
}
