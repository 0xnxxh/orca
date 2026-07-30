import { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'

type OrcaRuntimeRpcServerParameters = ConstructorParameters<typeof OrcaRuntimeRpcServer>

export function createOrcaRuntimeRpcServerStartupCapability(
  options: OrcaRuntimeRpcServerParameters[0]
): OrcaRuntimeRpcServer {
  return new OrcaRuntimeRpcServer(options)
}
