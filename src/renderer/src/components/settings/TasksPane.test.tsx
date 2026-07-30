// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings, TaskProvider } from '../../../../shared/types'
import type { TaskProviderReadiness } from './task-source-setup-state'
import { TasksPane } from './TasksPane'

const mocks = vi.hoisted(() => ({
  readiness: {} as Record<TaskProvider, TaskProviderReadiness>,
  openSettingsTarget: vi.fn(),
  openSettingsPage: vi.fn(),
  refreshPreflightStatus: vi.fn(),
  checkLinearConnection: vi.fn(),
  checkJiraConnection: vi.fn(),
  linearSetupProps: [] as { connected: boolean; checking: boolean }[]
}))

vi.mock('./use-task-source-provider-readiness', () => ({
  useTaskSourceProviderReadiness: () => mocks.readiness
}))

vi.mock('./use-integration-provider-status-refresh', () => ({
  useIntegrationProviderStatusRefresh: vi.fn()
}))

vi.mock('./TaskSourceLinearSetup', () => ({
  TaskSourceLinearSetup: (props: { connected: boolean; checking: boolean }) => {
    mocks.linearSetupProps.push(props)
    return <div data-testid="linear-setup">Linear setup steps</div>
  }
}))

vi.mock('./TaskSourceSimpleSetup', () => ({
  CodeHostSetupSteps: (props: { providerLabel: string }) => (
    <div data-testid={`code-host-${props.providerLabel}`}>Code host setup</div>
  ),
  JiraSetupSteps: () => <div data-testid="jira-setup">Jira setup</div>
}))

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      openSettingsPage: () => void
      openSettingsTarget: (target: unknown) => void
      refreshPreflightStatus: () => void
      checkLinearConnection: () => void
      checkJiraConnection: () => void
      settingsSearchQuery: string
    }) => unknown
  ) =>
    selector({
      openSettingsPage: mocks.openSettingsPage,
      openSettingsTarget: mocks.openSettingsTarget,
      refreshPreflightStatus: mocks.refreshPreflightStatus,
      checkLinearConnection: mocks.checkLinearConnection,
      checkJiraConnection: mocks.checkJiraConnection,
      settingsSearchQuery: ''
    })
}))

const baseSettings = {
  visibleTaskProviders: ['github', 'gitlab', 'linear'],
  defaultTaskSource: 'github'
} as GlobalSettings

const INCOMPLETE_BANNER = 'Some visible providers still need setup'
const LINEAR_SETUP_MARKER = 'data-testid="linear-setup"'

function renderPane(): string {
  return renderToStaticMarkup(<TasksPane settings={baseSettings} updateSettings={vi.fn()} />)
}

describe('TasksPane', () => {
  beforeEach(() => {
    mocks.linearSetupProps = []
    mocks.readiness = {
      github: { connected: true, checking: false, visible: true },
      gitlab: { connected: true, checking: false, visible: true },
      linear: {
        connected: false,
        checking: false,
        skillInstalled: false,
        skillChecking: false,
        visible: true
      },
      jira: { connected: false, checking: false, visible: false }
    }
  })

  it('frames Task Sources as a guided setup hub, not visibility-only toggles', () => {
    const markup = renderPane()

    expect(markup).toContain('Task management setup')
    expect(markup).toContain('Linear also needs the agent skill')
    expect(markup).toContain(INCOMPLETE_BANNER)
    expect(markup).toContain('Linear setup steps')
    expect(markup).toContain('Hide providers you do not use')
    expect(markup).toContain('API access, the agent skill, and Show in Tasks')
  })

  it('hides the incomplete banner when every visible provider is ready', () => {
    mocks.readiness.linear = {
      connected: true,
      checking: false,
      skillInstalled: true,
      skillChecking: false,
      visible: true
    }

    expect(renderPane()).not.toContain(INCOMPLETE_BANNER)
  })

  it('does not warn or expand while connection checks are still in flight', () => {
    mocks.readiness.github = { connected: false, checking: true, visible: true }
    mocks.readiness.gitlab = { connected: false, checking: true, visible: true }
    mocks.readiness.linear = {
      connected: false,
      checking: true,
      skillInstalled: false,
      skillChecking: true,
      visible: true
    }

    const markup = renderPane()

    expect(markup).not.toContain(INCOMPLETE_BANNER)
    expect(markup).not.toContain(LINEAR_SETUP_MARKER)
  })

  it('passes context-safe readiness into the expanded Linear setup', () => {
    renderPane()

    expect(mocks.linearSetupProps).toEqual([
      expect.objectContaining({ connected: false, checking: false })
    ])
  })

  it('auto-expands only the first incomplete provider', () => {
    mocks.readiness.gitlab = { connected: false, checking: false, visible: true }

    const markup = renderPane()

    // GitLab is first in provider order, so Linear stays collapsed.
    expect(markup).toContain('Code host setup')
    expect(markup).not.toContain(LINEAR_SETUP_MARKER)
  })

  it('leaves hidden providers out of the incomplete warning', () => {
    mocks.readiness.linear = {
      connected: false,
      checking: false,
      skillInstalled: false,
      skillChecking: false,
      visible: false
    }

    expect(renderPane()).not.toContain(INCOMPLETE_BANNER)
  })
})
