import { useRpcClientContext } from './rpc-client-react-context'

export const useCloseHost = () => useRpcClientContext().closeHost
export const useForceReconnect = () => useRpcClientContext().forceReconnect
export const usePrimeHosts = () => useRpcClientContext().primeHosts
