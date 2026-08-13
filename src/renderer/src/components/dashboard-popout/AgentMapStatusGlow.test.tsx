// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { card, installAgentMapEnvironment, renderMap } from './agent-map-render-test-harness'

describe('AgentMap status glow', () => {
  installAgentMapEnvironment()

  it.each([
    { bucket: 'working', dotState: 'working', unseen: false, glows: true },
    { bucket: 'attention', dotState: 'waiting', unseen: false, glows: true },
    { bucket: 'attention', dotState: 'blocked', unseen: false, glows: true },
    // An unread finish is the state the map exists to surface, so it halos like the
    // rest. Acknowledging it drops the halo — that is the seen/unseen difference.
    { bucket: 'done', dotState: 'done', unseen: true, glows: true },
    { bucket: 'done', dotState: 'done', unseen: false, glows: false },
    { bucket: 'idle', dotState: 'idle', unseen: false, glows: false }
  ] as const)(
    'applies the expected halo for $dotState agents (unseen: $unseen)',
    ({ glows, ...state }) => {
      const { container } = renderMap([card(state)])
      const glow = container.querySelector('[data-agent-map-agent-status-glow]')

      if (glows) {
        expect(glow).toHaveAttribute('data-agent-active-status', state.dotState)
        return
      }
      expect(glow).not.toBeInTheDocument()
    }
  )
})
