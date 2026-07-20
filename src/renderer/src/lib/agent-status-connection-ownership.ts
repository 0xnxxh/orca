import { parseAppSshPtyId } from '../../../shared/ssh-pty-id'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'

export type AgentStatusConnectionRouting = { connectionId: string | null }

export function resolveAgentStatusConnectionRouting(args: {
  ptyId: string | null | undefined
  expectedConnectionId?: string | null
  runtimeEnvironmentId?: string | null
}): AgentStatusConnectionRouting | undefined {
  const ptyId = args.ptyId?.trim()
  if (!ptyId) {
    return undefined
  }
  const expectedConnectionId = args.expectedConnectionId?.trim() || args.expectedConnectionId
  const sshPty = parseAppSshPtyId(ptyId)
  if (sshPty) {
    if (
      typeof args.runtimeEnvironmentId === 'string' ||
      expectedConnectionId === null ||
      (typeof expectedConnectionId === 'string' && expectedConnectionId !== sshPty.connectionId)
    ) {
      return undefined
    }
    return { connectionId: sshPty.connectionId }
  }
  if (ptyId.startsWith('ssh:')) {
    return undefined
  }

  const runtimePty = parseRemoteRuntimePtyId(ptyId)
  if (runtimePty?.handle) {
    if (
      typeof expectedConnectionId === 'string' ||
      args.runtimeEnvironmentId === null ||
      (typeof args.runtimeEnvironmentId === 'string' &&
        runtimePty.environmentId !== null &&
        runtimePty.environmentId !== args.runtimeEnvironmentId)
    ) {
      return undefined
    }
    return { connectionId: null }
  }
  if (ptyId.startsWith('remote:')) {
    return undefined
  }

  // Why: app-wide SSH and remote-runtime PTY IDs are namespaced; a remaining
  // concrete PTY is authoritative local/WSL ownership, never an SSH guess.
  if (typeof expectedConnectionId === 'string') {
    return undefined
  }
  return { connectionId: null }
}

export function isAgentStatusPanePtyBindingCurrent(
  terminalLayoutsByTabId:
    | Record<string, { ptyIdsByLeafId?: Record<string, string | undefined> } | undefined>
    | undefined,
  paneKey: string,
  ptyId: string
): boolean {
  const pane = parsePaneKey(paneKey)
  return pane
    ? terminalLayoutsByTabId?.[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId] === ptyId
    : false
}

export function isAgentStatusPtyLiveForPane(
  ptyIdsByTabId: Record<string, string[] | undefined> | undefined,
  paneKey: string,
  ptyId: string
): boolean {
  const pane = parsePaneKey(paneKey)
  return pane ? Boolean(ptyIdsByTabId?.[pane.tabId]?.includes(ptyId)) : false
}
