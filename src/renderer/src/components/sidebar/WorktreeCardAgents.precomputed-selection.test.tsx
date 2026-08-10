import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorktreeCardAgents from './WorktreeCardAgents'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'

vi.mock('./useWorktreeAgentRows', () => ({
  useWorktreeAgentRows: vi.fn(() => [])
}))

describe('WorktreeCardAgents precomputed selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not subscribe for agent rows when the card already computed them', () => {
    const markup = renderToStaticMarkup(<WorktreeCardAgents worktreeId="wt-1" agents={[]} />)

    expect(useWorktreeAgentRows).not.toHaveBeenCalled()
    expect(markup).toBe('')
  })
})
