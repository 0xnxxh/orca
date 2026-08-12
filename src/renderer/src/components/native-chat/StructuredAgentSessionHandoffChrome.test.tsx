// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'
import { StructuredAgentSessionHandoffChrome } from './StructuredAgentSessionHandoffChrome'

const IDLE_NATIVE: AgentSessionHandoffStatus = {
  owner: 'native',
  direction: null,
  phase: 'idle',
  stage: null,
  operationId: null
}

afterEach(cleanup)

describe('StructuredAgentSessionHandoffChrome', () => {
  it('uses queued-safe admission when the native view still appears idle', () => {
    const onRequest = vi.fn()
    render(
      <StructuredAgentSessionHandoffChrome
        status={IDLE_NATIVE}
        isWorking={false}
        onRequest={onRequest}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open agent TUI' }))

    expect(onRequest).toHaveBeenCalledWith('to-tui', 'after-turn')
  })
})
