import { Store } from '../persistence'

type StoreParameters = ConstructorParameters<typeof Store>

export function createStoreStartupCapability(...args: StoreParameters): Store {
  return new Store(...args)
}
