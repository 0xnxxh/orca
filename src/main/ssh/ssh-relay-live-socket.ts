import type { SshConnection } from './ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import { windowsRelayPipePathsForSocketName } from './ssh-relay-endpoints'
import { relayLivenessProbeCommand } from './ssh-remote-commands'
import {
  getRemoteHostPlatform,
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from './ssh-remote-platform'

const DEFAULT_REMOTE_HOST = getRemoteHostPlatform('linux-x64')

export async function hasLiveRelaySocket(
  conn: SshConnection,
  dir: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST,
  options?: {
    windowsNodePath?: string
    windowsSockNames?: string[]
  }
): Promise<boolean> {
  try {
    // Why: `test -S` only — a connect-and-close probe would race with a daemon about to idle.
    const windowsOptions =
      isWindowsRemoteHost(host) && options?.windowsNodePath
        ? {
            nodePath: options.windowsNodePath,
            pipePaths: (options.windowsSockNames ?? []).flatMap((sockName) =>
              windowsRelayPipePathsForSocketName(host, dir, sockName)
            )
          }
        : undefined
    const out = await execCommand(conn, relayLivenessProbeCommand(host, dir, windowsOptions), {
      wrapCommand: host.commandDialect !== 'powershell'
    })
    return !['DEAD', 'WAITING'].includes(out.trim())
  } catch {
    // Why: an inconclusive liveness probe must never authorize deletion.
    return true
  }
}
