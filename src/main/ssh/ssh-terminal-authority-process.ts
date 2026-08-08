import { randomBytes } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import type { SshConnection } from './ssh-connection'
import { createSshOperationAbortError } from './ssh-connection-utils'
import { waitForSentinel, execCommand } from './ssh-relay-deploy-helpers'
import { ensureRelayEndpointCredential } from './ssh-relay-endpoint-credential'
import { isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'
import type { RelayDaemonCompatibilityGrant } from '../../shared/relay-daemon-compatibility'
import {
  admitSshTerminalAuthority,
  admitSshTerminalAuthorityTakeover,
  assertSshTerminalAuthorityOwnerUnchanged,
  type SshTerminalAuthorityTakeover
} from './ssh-terminal-authority-admission'
import {
  discoverSshTerminalAuthority,
  proveSshTerminalAuthorityOwner,
  type SshTerminalAuthorityDiscovery
} from './ssh-terminal-authority-discovery'
import {
  sshTerminalAuthorityStateDirectoryCommand,
  type SshTerminalAuthorityEndpoint
} from './ssh-terminal-authority-endpoint'
import {
  sshTerminalAuthorityConnectCommand,
  sshTerminalAuthorityLaunchCommand,
  sshTerminalAuthorityReadyCommand
} from './ssh-terminal-authority-process-commands'

export {
  sshTerminalAuthorityConnectCommand,
  sshTerminalAuthorityLaunchCommand
} from './ssh-terminal-authority-process-commands'

const AUTHORITY_PROBE_CLOSE_TIMEOUT_MS = 5_000
const AUTHORITY_LAUNCH_CLOSE_TIMEOUT_MS = 5_000

export type SshTerminalAuthorityProcessOptions = Readonly<{
  conn: SshConnection
  host: RemoteHostPlatform
  remoteHome: string
  relayDir: string
  nodePath: string
  endpoint: SshTerminalAuthorityEndpoint
  discovery: SshTerminalAuthorityDiscovery
  graceTimeSeconds: number
  signal?: AbortSignal
}>

export type SshTerminalAuthorityProcess = Readonly<{
  markerPath: string
  authorityHostId: string
  ownerInstanceId: string
  revision: number
  ownerBuildId: string
  ownerRelayDir: string
  socketPath: string
  credentialFile: string
  compatibility: RelayDaemonCompatibilityGrant
}>

function closeAuthorityProbe(channel: ClientChannel, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      channel.removeListener('close', onClose)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onClose = (): void => finish()
    const onAbort = (): void => {
      channel.close()
      finish(createSshOperationAbortError())
    }
    const timer = setTimeout(() => {
      channel.close()
      finish(new Error('Terminal authority probe channel close was not confirmed'))
    }, AUTHORITY_PROBE_CLOSE_TIMEOUT_MS)
    timer.unref?.()
    channel.once('close', onClose)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    channel.close()
  })
}

function waitForAuthorityLaunchClose(channel: ClientChannel, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      channel.removeListener('close', onClose)
      channel.removeListener('error', onError)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onClose = (): void => finish()
    const onError = (error: Error): void => finish(error)
    const onAbort = (): void => {
      channel.close()
      finish(createSshOperationAbortError())
    }
    const timer = setTimeout(() => {
      channel.close()
      finish(new Error('Terminal authority launch channel close was not confirmed'))
    }, AUTHORITY_LAUNCH_CLOSE_TIMEOUT_MS)
    timer.unref?.()
    channel.once('close', onClose)
    channel.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
    }
  })
}

async function probeOwner(
  options: SshTerminalAuthorityProcessOptions,
  admitted: Extract<ReturnType<typeof admitSshTerminalAuthority>, { kind: 'connect-owner' }>
): Promise<SshTerminalAuthorityProcess> {
  const { marker } = admitted
  const channel = await options.conn.exec(
    sshTerminalAuthorityConnectCommand({
      host: options.host,
      nodePath: options.nodePath,
      ownerRelayDir: marker.ownerRelayDir,
      endpoint: options.endpoint,
      expectedOwner: marker
    }),
    { wrapCommand: !isWindowsRemoteHost(options.host), signal: options.signal }
  )
  try {
    await waitForSentinel(channel, options.signal)
  } catch (error) {
    channel.close()
    throw error
  }
  await closeAuthorityProbe(channel, options.signal)
  return {
    markerPath: options.endpoint.activeEndpointMarker,
    authorityHostId: marker.authorityHostId,
    ownerInstanceId: marker.ownerInstanceId,
    revision: marker.revision,
    ownerBuildId: marker.ownerBuildId,
    ownerRelayDir: marker.ownerRelayDir,
    socketPath: marker.socketPath,
    credentialFile: marker.credentialFile,
    compatibility: {
      ...admitted.compatibility,
      capabilities: [...admitted.compatibility.capabilities]
    }
  }
}

async function launchOwner(
  options: SshTerminalAuthorityProcessOptions,
  takeover?: SshTerminalAuthorityTakeover
): Promise<SshTerminalAuthorityProcess> {
  await execCommand(
    options.conn,
    sshTerminalAuthorityStateDirectoryCommand(options.host, options.endpoint.stateDir),
    { wrapCommand: !isWindowsRemoteHost(options.host), signal: options.signal }
  )
  await ensureRelayEndpointCredential(
    options.conn,
    options.host,
    options.nodePath,
    options.endpoint.credentialFile,
    { signal: options.signal }
  )
  const processToken = randomBytes(24).toString('base64url')
  const launchChannel = await options.conn.exec(
    sshTerminalAuthorityLaunchCommand({
      host: options.host,
      nodePath: options.nodePath,
      relayDir: options.relayDir,
      endpoint: options.endpoint,
      processToken,
      graceTimeSeconds: options.graceTimeSeconds,
      ...(takeover ? { takeover } : {})
    }),
    { wrapCommand: !isWindowsRemoteHost(options.host), signal: options.signal }
  )
  launchChannel.on('data', () => {})
  launchChannel.on('error', () => {})
  launchChannel.stderr.on('data', () => {})
  launchChannel.stderr.on('error', () => {})
  await waitForAuthorityLaunchClose(launchChannel, options.signal)
  const readiness = await execCommand(
    options.conn,
    sshTerminalAuthorityReadyCommand({
      host: options.host,
      nodePath: options.nodePath,
      relayDir: options.relayDir,
      socketPath: options.endpoint.socketPath
    }),
    { wrapCommand: !isWindowsRemoteHost(options.host), signal: options.signal }
  )
  if (readiness.trim() !== 'READY') {
    throw new Error('Terminal authority failed to publish a live endpoint')
  }
  const discovery = await discoverSshTerminalAuthority(
    options.conn,
    options.host,
    options.endpoint.activeEndpointMarker,
    { signal: options.signal }
  )
  const admitted = admitSshTerminalAuthority(
    discovery,
    options.host,
    options.remoteHome,
    options.endpoint
  )
  if (admitted.kind !== 'connect-owner') {
    throw new Error('Terminal authority endpoint became live without an owner marker')
  }
  return probeOwner(options, admitted)
}

export async function establishSshTerminalAuthority(
  options: SshTerminalAuthorityProcessOptions
): Promise<SshTerminalAuthorityProcess> {
  const admitted = admitSshTerminalAuthority(
    options.discovery,
    options.host,
    options.remoteHome,
    options.endpoint
  )
  if (admitted.kind === 'launch-first-owner') {
    return launchOwner(options)
  }
  try {
    return await probeOwner(options, admitted)
  } catch (connectError) {
    options.signal?.throwIfAborted()
    const rediscovery = await discoverSshTerminalAuthority(
      options.conn,
      options.host,
      options.endpoint.activeEndpointMarker,
      { signal: options.signal }
    )
    assertSshTerminalAuthorityOwnerUnchanged({
      expectedMarker: admitted.marker,
      rediscovery,
      host: options.host,
      remoteHome: options.remoteHome,
      endpoint: options.endpoint
    })
    const ownerProof = await proveSshTerminalAuthorityOwner(
      options.conn,
      options.host,
      admitted.marker,
      { signal: options.signal }
    )
    const takeover = admitSshTerminalAuthorityTakeover({
      expectedMarker: admitted.marker,
      rediscovery,
      ownerProof,
      host: options.host,
      remoteHome: options.remoteHome,
      endpoint: options.endpoint
    })
    try {
      return await launchOwner(options, takeover)
    } catch (takeoverError) {
      throw new AggregateError(
        [connectError, takeoverError],
        'Terminal authority reconnect and exact takeover both failed'
      )
    }
  }
}
