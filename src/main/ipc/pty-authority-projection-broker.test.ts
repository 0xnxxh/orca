import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_AUTHORITY_APP_PROJECTION_VERSION } from '../../shared/terminal-authority-app-projection'
import { PtyAuthorityProjectionBroker } from './pty-authority-projection-broker'

describe('PtyAuthorityProjectionBroker', () => {
  it('returns a snapshot and publishes only to the admitted renderer incarnation', async () => {
    const row = { consumerId: 'app-profile:test' } as never
    const send = vi.fn()
    const renderer = {}
    const broker = new PtyAuthorityProjectionBroker(() => [row])
    broker.attachRenderer(renderer, send)

    await expect(broker.subscribe(renderer, subscription('renderer-1'))).resolves.toMatchObject({
      subscriptionIncarnationId: 'renderer-1',
      rows: [row]
    })
    broker.publish(
      [row],
      [
        {
          consumerId: 'app-profile:test',
          namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
          pane: { paneKey: 'pane-1', paneGenerationId: 'generation-1' }
        }
      ]
    )

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionIncarnationId: 'renderer-1',
        rows: [row],
        deleted: [expect.objectContaining({ consumerId: 'app-profile:test' })]
      })
    )
  })

  it('fences an admitted subscription when navigation starts before it executes', async () => {
    const renderer = {}
    const broker = new PtyAuthorityProjectionBroker(() => [])
    broker.attachRenderer(renderer, vi.fn())
    const admission = broker.admitRendererRequest(renderer)
    const subscriptionPromise = broker.subscribe(renderer, subscription('renderer-1'), admission)

    broker.resetRenderer(renderer)

    await expect(subscriptionPromise).rejects.toThrow('subscription_stale')
  })

  it('accepts a fresh reload after fencing the previous renderer subscription', async () => {
    const renderer = {}
    const broker = new PtyAuthorityProjectionBroker(() => [])
    broker.attachRenderer(renderer, vi.fn())
    await broker.subscribe(renderer, subscription('renderer-1'))
    broker.resetRenderer(renderer)

    await expect(
      broker.subscribe(renderer, subscription('renderer-2', 'renderer-1'))
    ).resolves.toMatchObject({ subscriptionIncarnationId: 'renderer-2' })
  })
})

function subscription(
  subscriptionIncarnationId: string,
  expectedSubscriptionIncarnationId: string | null = null
) {
  return {
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    subscriptionIncarnationId,
    expectedSubscriptionIncarnationId
  }
}
