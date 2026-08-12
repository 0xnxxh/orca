import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { OrcaRuntimeService } from './orca-runtime'

afterEach(() => setStructuredAgentSessionHost(null))

describe('structured session cold restoration', () => {
  it('hydrates PTY inventory before recovering durable TUI owners and only runs once', async () => {
    const runtime = new OrcaRuntimeService()
    const hydrate = vi.fn()
    const refresh = vi.fn(async () => new Set<string>())
    const ensureHost = vi.fn(async () => undefined)
    const restoreReadableSessions = vi.fn(async () => undefined)
    const internal = runtime as unknown as {
      getKnownWorkspaceSessionWorktreeIds(): Set<string>
      hydrateHeadlessMobileSessionTabsFromWorkspaceSession(
        worktreeId?: string,
        options?: { allowAttachedWindow?: boolean; onlyRuntimeOwnedTerminals?: boolean }
      ): Set<string>
      refreshMobileSessionPtyRecords(): Promise<Set<string> | null>
      ensureStructuredAgentSessionHost(): Promise<void>
    }
    internal.getKnownWorkspaceSessionWorktreeIds = () => new Set(['workspace-1'])
    internal.hydrateHeadlessMobileSessionTabsFromWorkspaceSession = hydrate
    internal.refreshMobileSessionPtyRecords = refresh
    internal.ensureStructuredAgentSessionHost = ensureHost
    setStructuredAgentSessionHost({
      restoreReadableSessions,
      listSessionTabs: () => []
    } as never)

    await runtime.restoreStructuredAgentSessionTabs()
    await runtime.restoreStructuredAgentSessionTabs()

    expect(hydrate).toHaveBeenCalledWith('workspace-1', {
      allowAttachedWindow: true,
      onlyRuntimeOwnedTerminals: true
    })
    expect(hydrate).toHaveBeenCalledWith()
    expect(refresh).toHaveBeenCalledOnce()
    expect(restoreReadableSessions).toHaveBeenCalledOnce()
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      restoreReadableSessions.mock.invocationCallOrder[0] ?? Infinity
    )
  })
})
