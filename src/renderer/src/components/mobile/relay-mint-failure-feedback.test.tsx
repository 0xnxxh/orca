// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSendRelayMintFailureFeedback } from './relay-mint-failure-feedback'
import type { MobileRelayMintFailure } from '../../../../shared/mobile-relay-mint-failure'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

const failure: MobileRelayMintFailure = {
  code: 'relay_binding_failed',
  stage: 'binding_failed',
  message: 'Could not bind the relay session.'
}

function SendButton(): React.JSX.Element {
  const send = useSendRelayMintFailureFeedback()
  return (
    <button type="button" onClick={() => void send({ failure, preferredConnectionMode: 'relay' })}>
      send
    </button>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useSendRelayMintFailureFeedback', () => {
  it('drops repeat clicks while a send is in flight so one gh spawn and one report go out', async () => {
    const user = userEvent.setup()
    let resolveViewer: (value: null) => void = () => {}
    const viewer = vi.fn(() => new Promise<null>((resolve) => (resolveViewer = resolve)))
    const submit = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal(
      'window',
      Object.assign(window, { api: { gh: { viewer }, feedback: { submit } } })
    )

    render(<SendButton />)
    const button = screen.getByRole('button', { name: 'send' })
    await user.click(button)
    await user.click(button)
    await user.click(button)

    expect(viewer).toHaveBeenCalledTimes(1)
    resolveViewer(null)
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  })
})
