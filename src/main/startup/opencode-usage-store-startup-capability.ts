import { OpenCodeUsageStore } from '../opencode-usage/store'

type OpenCodeUsageStoreParameters = ConstructorParameters<typeof OpenCodeUsageStore>

export function createOpenCodeUsageStoreStartupCapability(
  store: OpenCodeUsageStoreParameters[0]
): OpenCodeUsageStore {
  return new OpenCodeUsageStore(store)
}
