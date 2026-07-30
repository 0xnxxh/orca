import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LinearAgentSkillGuide } from './LinearAgentSkillGuide'

describe('LinearAgentSkillGuide', () => {
  it('renders the setup checklist only', () => {
    const markup = renderToStaticMarkup(
      <LinearAgentSkillGuide
        status={{
          connected: true,
          connectionChecking: false,
          skillInstalled: false,
          skillChecking: false,
          visibleInTasks: true
        }}
        onOpenTaskSources={vi.fn()}
        onManageLinearAccess={vi.fn()}
      />
    )

    expect(markup).toContain('Setup checklist')
    expect(markup).toContain('2 of 3 ready')
    expect(markup).toContain('Open Task Sources setup')
    expect(markup).not.toContain('Good to know')
  })

  it('marks the checklist complete when every step is done', () => {
    const markup = renderToStaticMarkup(
      <LinearAgentSkillGuide
        status={{
          connected: true,
          connectionChecking: false,
          skillInstalled: true,
          skillChecking: false,
          visibleInTasks: true
        }}
        onOpenTaskSources={vi.fn()}
        onManageLinearAccess={vi.fn()}
      />
    )

    expect(markup).toContain('All set')
  })

  it('does not report stale completed checks as ready', () => {
    const markup = renderToStaticMarkup(
      <LinearAgentSkillGuide
        status={{
          connected: true,
          connectionChecking: true,
          skillInstalled: true,
          skillChecking: false,
          visibleInTasks: true
        }}
        onOpenTaskSources={vi.fn()}
        onManageLinearAccess={vi.fn()}
      />
    )

    expect(markup).toContain('2 of 3 ready')
    expect(markup).not.toContain('All set')
  })
})
