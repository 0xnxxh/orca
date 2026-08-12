import { resolveLocalAgentStartupShell } from '../shared/local-agent-startup-shell'
import type { AgentStartupShell } from '../shared/tui-agent-startup-shell'

/**
 * Startup-shell dialect for a command this main process will spawn itself.
 *
 * Why not the renderer's `getClientLoginShell`: that reads the preload bridge,
 * which does not exist here — and on a remote Orca host the shell that parses
 * the line is this process's `$SHELL`, not the connected client's. Launch
 * scopes here carry only a repo/folder + connectionId, so a non-remote scope on
 * this platform is always executed by this machine's login shell.
 */
export function resolveHostAgentStartupShell(args: {
  platform: NodeJS.Platform
  isRemote: boolean
  terminalWindowsShell?: string | null
}): AgentStartupShell | undefined {
  return resolveLocalAgentStartupShell({
    ...args,
    hostPlatform: process.platform,
    hostLoginShell: process.env.SHELL
  })
}
