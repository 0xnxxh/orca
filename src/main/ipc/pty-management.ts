import { ipcMain } from 'electron'
import { DaemonPtyRouter } from '../daemon/daemon-pty-router'
import { DegradedDaemonPtyProvider } from '../daemon/degraded-daemon-pty-provider'
import type { DaemonPtyAdapter } from '../daemon/daemon-pty-adapter'
import {
  getCurrentDaemonMacTccAttributionHealth,
  getDaemonProvider,
  restartDaemon
} from '../daemon/daemon-init'
import type { MacDaemonTccAttributionHealth } from '../daemon/daemon-health'
import type { DaemonSessionInfo } from '../daemon/types'
import {
  killListedPty,
  listedPtyIdentityKey,
  type PtyListedKillTarget
} from '../providers/pty-listed-session-kill'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

// Why: poll past the daemon's 5s SIGTERM→SIGKILL ladder (KILL_TIMEOUT_MS in session.ts), else slow-exiting shells falsely look "refused".
const MAX_POLL_ATTEMPTS = 65
const POLL_INTERVAL_MS = 100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDaemonAdapters(): DaemonPtyAdapter[] {
  const provider = getDaemonProvider()
  if (!provider) {
    return []
  }
  if (provider instanceof DaemonPtyRouter || provider instanceof DegradedDaemonPtyProvider) {
    return [...provider.getAllAdapters()]
  }
  return [provider]
}

// Why: surface degraded mode (daemon alive but cannot spawn fresh PTYs) so the UI can warn new terminals lack persistence.
function isDaemonDegraded(): boolean {
  const provider = getDaemonProvider()
  return (
    provider instanceof DegradedDaemonPtyProvider &&
    provider.routesFreshSpawnsToLocalProvider === true
  )
}

type DaemonSessionInventory = Readonly<{
  sessions: DaemonSessionInfo[]
  failedProtocolVersions: number[]
}>

async function collectSessionInventory(
  adapters: DaemonPtyAdapter[]
): Promise<DaemonSessionInventory> {
  const results = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const sessions = await adapter.listSessions()
      return sessions.map<DaemonSessionInfo>((s) => ({
        ...s,
        protocolVersion: adapter.protocolVersion
      }))
    })
  )
  return {
    sessions: results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    failedProtocolVersions: results.flatMap((result, index) =>
      result.status === 'rejected' ? [adapters[index].protocolVersion] : []
    )
  }
}

async function collectSessions(adapters: DaemonPtyAdapter[]): Promise<DaemonSessionInfo[]> {
  return (await collectSessionInventory(adapters)).sessions
}

async function collectSessionsExact(adapters: DaemonPtyAdapter[]): Promise<DaemonSessionInfo[]> {
  const inventory = await collectSessionInventory(adapters)
  if (inventory.failedProtocolVersions.length > 0) {
    throw new Error(
      `pty_management_inventory_unavailable:${inventory.failedProtocolVersions.join(',')}`
    )
  }
  return inventory.sessions
}

type ExactDaemonSessionInfo = DaemonSessionInfo & {
  terminalSessionAuthorityAccess?: TerminalSessionAuthorityPtyAccess
  mutationRouteToken?: object
}

function daemonSessionTarget(session: ExactDaemonSessionInfo): PtyListedKillTarget {
  return {
    id: session.sessionId,
    ...(session.incarnationId ? { incarnationId: session.incarnationId } : {}),
    ...(session.terminalSessionAuthorityAccess
      ? { terminalSessionAuthorityAccess: session.terminalSessionAuthorityAccess }
      : {}),
    ...(session.mutationRouteToken ? { mutationRouteToken: session.mutationRouteToken } : {})
  }
}

function daemonSessionIdentityKey(session: ExactDaemonSessionInfo): string {
  return JSON.stringify([
    session.protocolVersion,
    listedPtyIdentityKey(daemonSessionTarget(session)) ?? ['unavailable', session.sessionId]
  ])
}

async function killDaemonSession(
  adapter: DaemonPtyAdapter,
  session: ExactDaemonSessionInfo
): Promise<boolean> {
  return await killListedPty(adapter, daemonSessionTarget(session), { immediate: true })
}

export function registerDaemonManagementHandlers(): void {
  ipcMain.removeHandler('pty:management:listSessions')
  ipcMain.removeHandler('pty:management:killAll')
  ipcMain.removeHandler('pty:management:killOne')
  ipcMain.removeHandler('pty:management:restart')
  ipcMain.removeHandler('pty:management:macTccAttribution')

  // Why: lets Settings warn that macOS privacy grants no longer reach daemon terminals (STA-3491).
  ipcMain.handle(
    'pty:management:macTccAttribution',
    async (): Promise<{ health: MacDaemonTccAttributionHealth }> => {
      try {
        return { health: await getCurrentDaemonMacTccAttributionHealth() }
      } catch {
        return { health: 'unknown' }
      }
    }
  )

  ipcMain.handle(
    'pty:management:listSessions',
    async (): Promise<{ sessions: DaemonSessionInfo[]; degraded: boolean }> => {
      const sessions = await collectSessions(getDaemonAdapters())
      return { sessions, degraded: isDaemonDegraded() }
    }
  )

  // Why: tears down sessions across all adapters (current + legacy); daemon processes survive. See docs/daemon-staleness-ux.md §Phase 1.
  ipcMain.handle(
    'pty:management:killAll',
    async (): Promise<{
      killedCount: number
      remainingCount: number
      killedSessionIds: string[]
    }> => {
      const adapters = getDaemonAdapters()
      // Why: snapshot session IDs up front so mid-kill respawns aren't counted as "remaining".
      const initial = await collectSessionsExact(adapters)
      const initialByIdentity = new Map(
        initial.map((session) => [daemonSessionIdentityKey(session), session] as const)
      )
      const initialIdentities = new Set(initialByIdentity.keys())
      const initialCount = initialByIdentity.size

      if (initialCount === 0) {
        return { killedCount: 0, remainingCount: 0, killedSessionIds: [] }
      }

      // Why: no retry — session.kill() is idempotent and runs its own kill ladder; allSettled so one rejection doesn't abort the rest.
      await Promise.allSettled(
        [...initialByIdentity.values()].map(async (session) => {
          // Why: assumes PROTOCOL_VERSION stays distinct from PREVIOUS_DAEMON_PROTOCOL_VERSIONS (types.ts), else legacy sessions misroute here.
          const owner = adapters.find((a) => a.protocolVersion === session.protocolVersion)
          if (!owner) {
            return
          }
          await killDaemonSession(owner, session).catch(() => false)
        })
      )

      // Why: count only the initial-snapshot intersection so renderer respawns mid-kill aren't counted as remaining.
      let remainingOriginalCount = initialCount
      let remainingOriginalIdentities = initialIdentities
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        await sleep(POLL_INTERVAL_MS)
        const current = await collectSessionsExact(adapters)
        remainingOriginalIdentities = new Set(
          current
            .map(daemonSessionIdentityKey)
            .filter((identity) => initialIdentities.has(identity))
        )
        remainingOriginalCount = remainingOriginalIdentities.size
        if (remainingOriginalCount === 0) {
          break
        }
      }

      const killedCount = initialCount - remainingOriginalCount
      return {
        killedCount,
        remainingCount: remainingOriginalCount,
        killedSessionIds: [...initialByIdentity]
          .filter(([identity]) => !remainingOriginalIdentities.has(identity))
          .map(([, session]) => session.sessionId)
      }
    }
  )

  ipcMain.handle(
    'pty:management:killOne',
    async (_event, args: { sessionId: string }): Promise<{ success: boolean }> => {
      if (typeof args?.sessionId !== 'string' || args.sessionId.length === 0) {
        return { success: false }
      }
      const adapters = getDaemonAdapters()
      let sessions: DaemonSessionInfo[]
      try {
        sessions = await collectSessionsExact(adapters)
      } catch {
        return { success: false }
      }
      const matches = sessions.filter((session) => session.sessionId === args.sessionId)
      if (matches.length !== 1) {
        return { success: false }
      }
      const match = matches[0]
      const owner = adapters.find((a) => a.protocolVersion === match.protocolVersion)
      if (!owner) {
        return { success: false }
      }
      try {
        return { success: await killDaemonSession(owner, match) }
      } catch {
        return { success: false }
      }
    }
  )

  ipcMain.handle('pty:management:restart', async (): Promise<{ success: boolean }> => {
    try {
      await restartDaemon()
      return { success: true }
    } catch (err) {
      console.error('[pty:management] restart failed', err)
      return { success: false }
    }
  })
}
