import { join } from 'node:path'
import { DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS } from '../shared/ssh-types'
import type { SshTerminalAuthorityEndpointIdentity } from '../shared/ssh-terminal-authority-marker'
import { isRelayLaunchFenceOwnerToken, type RelayLaunchFence } from './relay-launch-fence'

const DEFAULT_GRACE_MS = DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS * 1000
const DEFAULT_SOCKET_NAME = 'relay.sock'

export type TerminalAuthorityOwnerOptions = Readonly<{
  stateDir: string
  markerPath: string
  processToken: string
  takeover?: Readonly<{ ownerProcessToken: string; revision: number }>
}>

export type RelayStartupOptions = Readonly<{
  graceTimeMs: number
  connectMode: boolean
  detached: boolean
  terminalAuthority: boolean
  controlAdapter: boolean
  cliMode: boolean
  sockPath: string
  endpointDir?: string
  logFile?: string
  credentialFile?: string
  launchFence?: RelayLaunchFence
  authorityOwner?: TerminalAuthorityOwnerOptions
  authorityConnectExpectation?: SshTerminalAuthorityEndpointIdentity
  authorityGateway?: Readonly<{
    markerPath: string
    authorityHostId: string
    ownerInstanceId: string
    revision: number
  }>
}>

export function parseRelayStartupOptions(
  argv: readonly string[],
  workingDirectory = process.cwd()
): RelayStartupOptions {
  let graceTimeMs = DEFAULT_GRACE_MS
  let connectMode = false
  let detached = false
  let terminalAuthority = false
  let controlAdapter = false
  let cliMode = false
  let sockPath = ''
  let endpointDir: string | undefined
  let logFile: string | undefined
  let credentialFile: string | undefined
  let releaseLaunchInstallLock = false
  let releaseLaunchInstallLockOwner: string | undefined
  let releaseLaunchGcClaimOwner: string | undefined
  let authorityStateDir: string | undefined
  let authorityMarkerPath: string | undefined
  let authorityProcessToken: string | undefined
  let authorityTakeoverToken: string | undefined
  let authorityTakeoverRevision: number | undefined
  let authorityGatewayMarkerPath: string | undefined
  let authorityGatewayHostId: string | undefined
  let authorityGatewayOwnerInstanceId: string | undefined
  let authorityGatewayRevision: number | undefined
  let authorityExpectationHostId: string | undefined
  let authorityExpectationOwnerInstanceId: string | undefined
  let authorityExpectationRevision: number | undefined

  for (let i = 2; i < argv.length; i++) {
    const value = argv[i]
    const next = argv[i + 1]
    if (value === '--grace-time' && next) {
      const parsed = Number.parseInt(next, 10)
      if (!Number.isNaN(parsed) && parsed >= 0) {
        graceTimeMs = parsed * 1000
      }
      i++
    } else if (value === '--connect') {
      connectMode = true
    } else if (value === '--orca-cli') {
      cliMode = true
    } else if (value === '--detached') {
      detached = true
    } else if (value === '--terminal-authority') {
      terminalAuthority = true
    } else if (value === '--control-adapter') {
      controlAdapter = true
    } else if (value === '--sock-path' && next) {
      sockPath = next
      i++
    } else if (value === '--endpoint-dir' && next) {
      endpointDir = next
      i++
    } else if (value === '--log-file' && next) {
      logFile = next
      i++
    } else if (value === '--credential-file' && next) {
      credentialFile = next
      i++
    } else if (value === '--release-launch-install-lock') {
      releaseLaunchInstallLock = true
    } else if (value === '--release-launch-install-lock-owner') {
      if (!next || !isRelayLaunchFenceOwnerToken(next)) {
        throw new Error('Invalid relay launch install lock owner token')
      }
      releaseLaunchInstallLockOwner = next
      i++
    } else if (value === '--release-launch-gc-claim-owner') {
      if (!next || !isRelayLaunchFenceOwnerToken(next)) {
        throw new Error('Invalid relay launch GC claim owner token')
      }
      releaseLaunchGcClaimOwner = next
      i++
    } else if (value === '--authority-state-dir' && next) {
      authorityStateDir = next
      i++
    } else if (value === '--authority-marker-path' && next) {
      authorityMarkerPath = next
      i++
    } else if (value === '--authority-process-token' && next) {
      authorityProcessToken = next
      i++
    } else if (value === '--authority-takeover-token' && next) {
      authorityTakeoverToken = next
      i++
    } else if (value === '--authority-takeover-revision' && next) {
      const revision = Number(next)
      if (Number.isSafeInteger(revision) && revision > 0) {
        authorityTakeoverRevision = revision
      }
      i++
    } else if (value === '--authority-gateway-marker-path' && next) {
      authorityGatewayMarkerPath = next
      i++
    } else if (value === '--authority-gateway-host-id' && next) {
      authorityGatewayHostId = next
      i++
    } else if (value === '--authority-gateway-owner-instance' && next) {
      authorityGatewayOwnerInstanceId = next
      i++
    } else if (value === '--authority-gateway-revision' && next) {
      const revision = Number(next)
      if (Number.isSafeInteger(revision) && revision > 0) {
        authorityGatewayRevision = revision
      }
      i++
    } else if (value === '--authority-expect-host-id' && next) {
      authorityExpectationHostId = next
      i++
    } else if (value === '--authority-expect-owner-instance' && next) {
      authorityExpectationOwnerInstanceId = next
      i++
    } else if (value === '--authority-expect-revision' && next) {
      const revision = Number(next)
      if (Number.isSafeInteger(revision) && revision > 0) {
        authorityExpectationRevision = revision
      }
      i++
    }
  }

  const authorityValues = [authorityStateDir, authorityMarkerPath, authorityProcessToken]
  const hasAnyAuthorityValue = authorityValues.some((value) => value !== undefined)
  const hasAllAuthorityValues = authorityValues.every((value) => value !== undefined)
  if (hasAnyAuthorityValue && !hasAllAuthorityValues) {
    throw new Error('Incomplete terminal authority owner arguments')
  }
  if ((authorityTakeoverToken === undefined) !== (authorityTakeoverRevision === undefined)) {
    throw new Error('Incomplete terminal authority takeover arguments')
  }

  const authorityOwner =
    authorityStateDir && authorityMarkerPath && authorityProcessToken
      ? {
          stateDir: authorityStateDir,
          markerPath: authorityMarkerPath,
          processToken: authorityProcessToken,
          ...(authorityTakeoverToken && authorityTakeoverRevision
            ? {
                takeover: {
                  ownerProcessToken: authorityTakeoverToken,
                  revision: authorityTakeoverRevision
                }
              }
            : {})
        }
      : undefined
  if (Boolean(authorityOwner) !== terminalAuthority) {
    throw new Error('Terminal authority mode requires one complete owner claim')
  }
  if (terminalAuthority && controlAdapter) {
    throw new Error('Relay cannot be both a terminal authority and a control adapter')
  }
  const gatewayValues = [
    authorityGatewayMarkerPath,
    authorityGatewayHostId,
    authorityGatewayOwnerInstanceId,
    authorityGatewayRevision
  ]
  const hasAnyGatewayValue = gatewayValues.some((value) => value !== undefined)
  const hasAllGatewayValues = gatewayValues.every((value) => value !== undefined)
  if (hasAnyGatewayValue && !hasAllGatewayValues) {
    throw new Error('Incomplete terminal authority gateway arguments')
  }
  const authorityGateway =
    authorityGatewayMarkerPath &&
    authorityGatewayHostId &&
    authorityGatewayOwnerInstanceId &&
    authorityGatewayRevision
      ? {
          markerPath: authorityGatewayMarkerPath,
          authorityHostId: authorityGatewayHostId,
          ownerInstanceId: authorityGatewayOwnerInstanceId,
          revision: authorityGatewayRevision
        }
      : undefined
  if (authorityGateway && !controlAdapter) {
    throw new Error('Terminal authority gateway requires control-adapter mode')
  }
  const expectationValues = [
    authorityExpectationHostId,
    authorityExpectationOwnerInstanceId,
    authorityExpectationRevision
  ]
  const hasAnyExpectationValue = expectationValues.some((value) => value !== undefined)
  const hasAllExpectationValues = expectationValues.every((value) => value !== undefined)
  if (hasAnyExpectationValue && !hasAllExpectationValues) {
    throw new Error('Incomplete terminal authority connect expectation')
  }
  const authorityConnectExpectation =
    authorityExpectationHostId &&
    authorityExpectationOwnerInstanceId &&
    authorityExpectationRevision
      ? {
          authorityHostId: authorityExpectationHostId,
          ownerInstanceId: authorityExpectationOwnerInstanceId,
          revision: authorityExpectationRevision
        }
      : undefined
  if (authorityConnectExpectation && !connectMode) {
    throw new Error('Terminal authority expectation requires connect mode')
  }
  if (releaseLaunchInstallLock !== Boolean(releaseLaunchInstallLockOwner)) {
    throw new Error('Incomplete relay launch install lock owner identity')
  }
  const launchFence =
    releaseLaunchInstallLock || releaseLaunchGcClaimOwner
      ? {
          ...(releaseLaunchInstallLock ? { releaseInstallLock: true as const } : {}),
          ...(releaseLaunchInstallLockOwner
            ? { installLockOwnerToken: releaseLaunchInstallLockOwner }
            : {}),
          ...(releaseLaunchGcClaimOwner ? { gcClaimOwnerToken: releaseLaunchGcClaimOwner } : {})
        }
      : undefined
  if (launchFence && !connectMode && !(detached && controlAdapter)) {
    throw new Error('Relay launch fence release requires connect or detached control mode')
  }

  return {
    graceTimeMs,
    connectMode,
    detached,
    terminalAuthority,
    controlAdapter,
    cliMode,
    sockPath: sockPath || join(workingDirectory, DEFAULT_SOCKET_NAME),
    endpointDir,
    logFile,
    credentialFile,
    ...(launchFence ? { launchFence } : {}),
    ...(authorityOwner ? { authorityOwner } : {}),
    ...(authorityConnectExpectation ? { authorityConnectExpectation } : {}),
    ...(authorityGateway ? { authorityGateway } : {})
  }
}
