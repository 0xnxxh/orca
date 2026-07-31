import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getMobileTerminalHotSetRouteSafetyFailure } from './mobile-terminal-hot-set-route-safety'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)
const hookSource = readFileSync(
  new URL('./use-mobile-terminal-hot-set.ts', import.meta.url),
  'utf8'
)
const integrationSource = readFileSync(
  new URL('./use-mobile-terminal-hot-set-integration.ts', import.meta.url),
  'utf8'
)
const routeSafetySource = readFileSync(
  new URL('./mobile-terminal-hot-set-route-safety.ts', import.meta.url),
  'utf8'
)

describe('mobile terminal hot-set route integration', () => {
  it('keeps the release-channel flag off unless explicitly enabled', () => {
    expect(hookSource).toContain("process.env.EXPO_PUBLIC_ORCA_MOBILE_TERMINAL_HOT_SET === '1'")
    expect(integrationSource).toContain('featureEnabled: MOBILE_TERMINAL_HOT_SET_ENABLED')
    expect(integrationSource).toContain("args.connectionState === 'connected' ? null")
  })

  it('filters only mounted panes while retaining the durable terminal records', () => {
    expect(routeSource).toContain(
      '.filter((terminal) => mountedTerminalHandles.has(terminal.handle))'
    )
    expect(routeSource).toContain('handles: terminals.map((terminal) => terminal.handle)')
    expect(routeSource).toContain('setTerminals((prev) =>')
  })

  it('gates late stream frames and fails open before cold hydration', () => {
    expect(routeSource).toContain('!acceptsHotSetStreamEvent(handle)')
    expect(integrationSource).toContain("failOpen('invalid-cold-scrollback')")
    expect(integrationSource).toContain("failOpen('cold-render-ready-timeout')")
    expect(integrationSource).toContain("failOpen('cold-webview-readiness')")
    expect(routeSource).toContain("terminateHotSetStream(handle, 'cold-stream-closed')")
    expect(integrationSource).toContain("'connection-uncertain'")
    expect(routeSafetySource).toContain("'route-reused'")
    expect(routeSafetySource).toContain("'stale-activation-generation'")
    expect(routeSource.match(/subscribeMobileTerminalSafely\(/g)).toHaveLength(1)
  })

  it('keeps layout sequence ownership limited to layout staleness', () => {
    expect(routeSource).toContain(
      'highest applyLayout seq seen per handle; drop older scrollback/resized as stale'
    )
    expect(hookSource).not.toContain('layoutSeq')
  })

  it('keeps the hot set admissible across terminal to non-terminal navigation', () => {
    const routeFailure = (activeHandle: string | null, activeTerminalHandleExpected: boolean) =>
      getMobileTerminalHotSetRouteSafetyFailure({
        initialScopeKey: 'host:worktree',
        scopeKey: 'host:worktree',
        handles: ['terminal-a', 'terminal-b'],
        activeHandle,
        activeTerminalHandleExpected
      })

    expect(routeFailure('terminal-a', true)).toBeNull()
    expect(routeFailure(null, false)).toBeNull()
    expect(routeFailure('terminal-b', true)).toBeNull()
  })
})
