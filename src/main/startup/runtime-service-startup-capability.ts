import { OrcaRuntimeService } from '../runtime/orca-runtime'

type OrcaRuntimeServiceParameters = ConstructorParameters<typeof OrcaRuntimeService>

export function createOrcaRuntimeServiceStartupCapability(
  ...args: OrcaRuntimeServiceParameters
): OrcaRuntimeService {
  return new OrcaRuntimeService(...args)
}
