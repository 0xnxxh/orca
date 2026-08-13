import {
  createShellReadyScanState,
  drainShellReadyHeldBytes,
  scanForShellReady,
  type ShellReadyScanState
} from './shell-ready-marker-scanner'
import {
  createShellStartupIdentityScanState,
  drainShellStartupIdentityHeldBytes,
  scanForShellStartupIdentity,
  type ShellStartupIdentityScanState
} from './shell-startup-identity-scanner'

export type ShellStartupOutputScanState = {
  ready: ShellReadyScanState
  identity: ShellStartupIdentityScanState | null
}

export type ShellStartupOutputScanResult = {
  output: string
  shellPid: number | null
  ready: boolean
  postMarkerBytesObserved: boolean
}

export function createShellStartupOutputScanState(): ShellStartupOutputScanState {
  return {
    ready: createShellReadyScanState(),
    identity: createShellStartupIdentityScanState()
  }
}

export function scanShellStartupOutput(
  state: ShellStartupOutputScanState,
  data: string
): ShellStartupOutputScanResult {
  let shellPid: number | null = null
  if (state.identity) {
    const identity = scanForShellStartupIdentity(state.identity, data)
    data = identity.output
    shellPid = identity.shellPid
    if (shellPid) {
      state.identity = null
    }
  }

  const readiness = scanForShellReady(state.ready, data)
  let output = readiness.output
  let postMarkerBytesObserved = readiness.postMarkerBytesObserved
  if (readiness.matched && state.identity) {
    const heldOutput = drainShellStartupIdentityHeldBytes(state.identity)
    output += heldOutput
    postMarkerBytesObserved ||= heldOutput.length > 0
    state.identity = null
  }
  return {
    output,
    shellPid,
    ready: readiness.matched,
    postMarkerBytesObserved
  }
}

export function drainShellStartupOutputScanState(state: ShellStartupOutputScanState): string {
  let output = state.identity ? drainShellStartupIdentityHeldBytes(state.identity) : ''
  state.identity = null
  if (output) {
    output = scanForShellReady(state.ready, output).output
  }
  return output + drainShellReadyHeldBytes(state.ready)
}
