import { EmulatorBridge } from '../emulator/emulator-bridge'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

type EmulatorStartupRuntime = Pick<OrcaRuntimeService, 'setEmulatorBridge'>

export function attachEmulatorStartupCapability(runtime: EmulatorStartupRuntime): EmulatorBridge {
  const bridge = new EmulatorBridge()
  runtime.setEmulatorBridge(bridge)
  return bridge
}
