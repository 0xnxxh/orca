import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

const mocks = vi.hoisted(() => ({
  now: 1_000_000_000,
  useResetCountdownClock: vi.fn(() => 1_000_000_000)
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: ({ agent }: { agent: string }) => <span data-agent-icon={agent} />
}))
vi.mock('@/hooks/useResetCountdownClock', () => ({
  useResetCountdownClock: mocks.useResetCountdownClock
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange: _onCheckedChange,
    onSelect: _onSelect,
    ...props
  }: React.PropsWithChildren<{
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    onSelect?: () => void
  }>) => (
    <div data-checked={checked} {...props}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect: _onSelect,
    ...props
  }: React.PropsWithChildren<{ onSelect?: () => void }>) => <div {...props}>{children}</div>
}))

import { UsageRosterPanel, UsageRow } from './UsageRosterPanel'

const signedOutCodex: ProviderRateLimits = {
  provider: 'codex',
  session: null,
  weekly: null,
  updatedAt: 0,
  error: 'ChatGPT authentication required to read rate limits',
  status: 'error'
}

describe('UsageRow', () => {
  beforeEach(() => {
    mocks.useResetCountdownClock.mockClear()
  })

  it('renders sign-in as row copy instead of nesting an interactive button', () => {
    const markup = renderToStaticMarkup(
      <UsageRow
        p={signedOutCodex}
        display="used"
        state={{ kind: 'sign-in', statusLabel: 'not signed in' }}
        showSignInAction
        now={mocks.now}
      />
    )

    expect(markup).toContain('not signed in')
    expect(markup).toContain('Sign in')
    expect(markup).not.toContain('<button')
  })

  it('keeps the bar fill consistent with the remaining percentage label', () => {
    const markup = renderToStaticMarkup(
      <UsageRow
        p={{
          ...signedOutCodex,
          session: {
            usedPercent: 25,
            windowMinutes: 300,
            resetsAt: null,
            resetDescription: null
          },
          status: 'ok',
          error: null
        }}
        display="remaining"
        state={{ kind: 'usage', statusLabel: null }}
        showSignInAction={false}
        now={mocks.now}
      />
    )

    expect(markup).toContain('75%')
    expect(markup).toContain('width:75%')
    expect(markup).not.toContain('width:25%')
  })

  it('uses one shared clock for live reset labels across the roster', () => {
    const sessionReset = mocks.now + 2 * 60_000
    const weeklyReset = mocks.now + 7 * 24 * 60 * 60_000
    const markup = renderToStaticMarkup(
      <UsageRosterPanel
        providers={[
          {
            ...signedOutCodex,
            session: {
              usedPercent: 25,
              windowMinutes: 300,
              resetsAt: sessionReset,
              resetDescription: null
            },
            weekly: {
              usedPercent: 10,
              windowMinutes: 10_080,
              resetsAt: weeklyReset,
              resetDescription: null
            },
            status: 'ok',
            error: null
          }
        ]}
        display="used"
        statusBarUsageMode="verbose"
        onStatusBarUsageModeChange={() => {}}
        isRefreshing={false}
        onRefresh={() => {}}
        onOpenProvider={() => {}}
        onSignIn={() => {}}
        canSignIn={() => true}
        onManageAccounts={() => {}}
        onUsageDetails={() => {}}
      />
    )

    expect(mocks.useResetCountdownClock).toHaveBeenCalledOnce()
    expect(mocks.useResetCountdownClock).toHaveBeenCalledWith([sessionReset, weeklyReset])
    expect(markup).toContain('Resets in 2m')
    expect(markup).toContain('Verbose footer')
    expect(markup).toContain('data-checked="true"')
  })
})
