import type { ExecutionHostKind } from './execution-host'
import { resolveLoginShellStartupDialect, type AgentStartupShell } from './tui-agent-startup-shell'
import { resolveLocalWindowsAgentStartupShell } from './windows-terminal-shell'

export type LocalAgentStartupShellArgs = {
  /** Platform of the host that will run the queued command. */
  platform: NodeJS.Platform
  isRemote: boolean
  terminalWindowsShell?: string | null
  /** Platform of the process resolving this, i.e. the owner of `hostLoginShell`. */
  hostPlatform: NodeJS.Platform
  /** `$SHELL` of that same process's machine. */
  hostLoginShell?: string | null
  /** Execution owner of the target workspace, when the caller can determine one. */
  executionHostKind?: ExecutionHostKind | null
}

/**
 * Startup-shell dialect for a queued agent command, POSIX included.
 *
 * Why POSIX needs a dialect at all: fish has no `unset`, so a draft-prefill
 * teardown must be `set -e VAR` there. Why the guards are strict: `set -e` in
 * bash enables errexit instead of clearing anything, so the local login shell
 * may pick the dialect only when it is provably the shell that parses the line.
 */
export function resolveLocalAgentStartupShell(
  args: LocalAgentStartupShellArgs
): AgentStartupShell | undefined {
  if (args.platform === 'win32' || args.isRemote) {
    return resolveLocalWindowsAgentStartupShell(args)
  }
  if (args.executionHostKind === 'ssh' || args.executionHostKind === 'runtime') {
    return undefined
  }
  // Why: a WSL workspace resolves to 'linux' on a win32 host — a different shell entirely.
  if (args.hostPlatform !== args.platform) {
    return undefined
  }
  return resolveLoginShellStartupDialect(args.hostLoginShell)
}
