import { useRpcClientContext } from './client-context'

export const useCloseHost = () => useRpcClientContext().closeHost
export const useForceReconnect = () => useRpcClientContext().forceReconnect
export const usePrimeHosts = () => useRpcClientContext().primeHosts
