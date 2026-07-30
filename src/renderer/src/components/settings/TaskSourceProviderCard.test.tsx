import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TaskSourceProviderCard } from './TaskSourceProviderCard'

const readiness = {
  connected: false,
  checking: false,
  skillInstalled: false,
  skillChecking: false,
  visible: true
}

describe('TaskSourceProviderCard', () => {
  it('shows the visibility action in only one place when expanded', () => {
    const markup = renderToStaticMarkup(
      <TaskSourceProviderCard
        icon={<span />}
        name="Linear"
        description="Linear setup"
        readiness={readiness}
        visible
        canHide
        defaultExpanded
        onToggleVisible={vi.fn()}
      >
        <button aria-label="Hide Linear from Tasks">Shown</button>
      </TaskSourceProviderCard>
    )

    expect(markup.match(/aria-label="Hide Linear from Tasks"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="Collapse Linear setup steps"')
    expect(markup).toContain('aria-expanded="true"')
  })

  it('keeps visibility available while setup steps are collapsed', () => {
    const markup = renderToStaticMarkup(
      <TaskSourceProviderCard
        icon={<span />}
        name="Linear"
        description="Linear setup"
        readiness={readiness}
        visible
        canHide
        defaultExpanded={false}
        onToggleVisible={vi.fn()}
      >
        <span>Expanded content</span>
      </TaskSourceProviderCard>
    )

    expect(markup).toContain('aria-label="Hide Linear from Tasks"')
    expect(markup).toContain('aria-label="Show Linear setup steps"')
    expect(markup).not.toContain('Expanded content')
  })
})
