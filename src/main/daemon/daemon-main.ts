import { DaemonServer, type DaemonServerOptions } from './daemon-server'
import type { DaemonFileLog } from './daemon-file-log'
import type { TerminalSessionAuthorityHostRuntime } from '../session-authority/terminal-session-authority-host-runtime'

export type DaemonStartOptions = {
  socketPath: string
  tokenPath: string
  pidPath?: string
  launchNonce?: string
  startedAtMs?: number
  publishEndpointOwnership?: DaemonServerOptions['publishEndpointOwnership']
  entryPath?: string
  appVersion?: string
  spawnerExecPath?: string
  /** Direct-construction seam for versioned protocol fixtures; never CLI/env configured. */
  protocolVersion?: number
  spawnSubprocess: DaemonServerOptions['spawnSubprocess']
  preparePtySpawn?: DaemonServerOptions['preparePtySpawn']
  onPtySessionExit?: DaemonServerOptions['onPtySessionExit']
  onAuthenticatedClientPair?: DaemonServerOptions['onAuthenticatedClientPair']
  log?: DaemonFileLog
  onIdleShutdown?: () => void
  onRpcShutdown?: () => void
  onTerminalSessionAuthorityFailure?: (error: Error) => void
  initialAdoptionTestConfig?: DaemonServerOptions['initialAdoptionTestConfig']
  terminalSessionAuthorityRuntime?: TerminalSessionAuthorityHostRuntime
}

export type DaemonHandle = {
  shutdown(): Promise<void>
}

export async function startDaemon(opts: DaemonStartOptions): Promise<DaemonHandle> {
  const server = new DaemonServer({
    socketPath: opts.socketPath,
    tokenPath: opts.tokenPath,
    ...(opts.pidPath ? { pidPath: opts.pidPath } : {}),
    ...(opts.launchNonce ? { launchNonce: opts.launchNonce } : {}),
    ...(opts.startedAtMs ? { startedAtMs: opts.startedAtMs } : {}),
    ...(opts.publishEndpointOwnership
      ? { publishEndpointOwnership: opts.publishEndpointOwnership }
      : {}),
    ...(opts.entryPath ? { entryPath: opts.entryPath } : {}),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    ...(opts.spawnerExecPath ? { spawnerExecPath: opts.spawnerExecPath } : {}),
    ...(opts.protocolVersion !== undefined ? { protocolVersion: opts.protocolVersion } : {}),
    spawnSubprocess: opts.spawnSubprocess,
    ...(opts.preparePtySpawn ? { preparePtySpawn: opts.preparePtySpawn } : {}),
    ...(opts.onPtySessionExit ? { onPtySessionExit: opts.onPtySessionExit } : {}),
    ...(opts.onAuthenticatedClientPair
      ? { onAuthenticatedClientPair: opts.onAuthenticatedClientPair }
      : {}),
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.onIdleShutdown ? { onIdleShutdown: opts.onIdleShutdown } : {}),
    ...(opts.onRpcShutdown ? { onRpcShutdown: opts.onRpcShutdown } : {}),
    ...(opts.onTerminalSessionAuthorityFailure
      ? { onTerminalSessionAuthorityFailure: opts.onTerminalSessionAuthorityFailure }
      : {}),
    ...(opts.initialAdoptionTestConfig
      ? { initialAdoptionTestConfig: opts.initialAdoptionTestConfig }
      : {}),
    ...(opts.terminalSessionAuthorityRuntime
      ? {
          terminalSessionAuthority: {
            ptyOwner: opts.terminalSessionAuthorityRuntime.ptyOwner,
            authorityHostId: opts.terminalSessionAuthorityRuntime.authorityHostId
          },
          terminalSessionAuthorityCapabilityReadiness: {
            hostEffectConsumerInstalled: () =>
              opts.terminalSessionAuthorityRuntime!.ptyOwner.hostEffectConsumerInstalled()
          }
        }
      : {})
  })

  await server.start()

  return {
    shutdown: async () => {
      await server.shutdown()
      await opts.terminalSessionAuthorityRuntime?.close()
    }
  }
}
