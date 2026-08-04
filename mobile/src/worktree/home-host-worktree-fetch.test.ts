import { describe, expect, it } from 'vitest'
import { createHostConnectRefetchGate } from '../transport/host-connect-refetch-gate'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { fetchHomeHostWorktreeInfo } from './home-host-worktree-fetch'
import type { HostWorktreeInfo } from './home-worktree-info'

type FakeClient = {
  client: RpcClient
  calls: number
  settle: (response: RpcResponse | Error) => void
}

function fakeClient(): FakeClient {
  const pending: Array<(response: RpcResponse | Error) => void> = []
  const fake = {
    calls: 0,
    settle(response: RpcResponse | Error) {
      const next = pending.shift()
      next?.(response)
    },
    client: {
      sendRequest: () => {
        fake.calls += 1
        return new Promise<RpcResponse>((resolve, reject) => {
          pending.push((response) =>
            response instanceof Error ? reject(response) : resolve(response)
          )
        })
      }
    } as unknown as RpcClient
  }
  return fake
}

function catalogResponse(count: number, active: number): RpcResponse {
  const worktrees = Array.from({ length: count }, (_, index) => ({
    worktreeId: `wt-${index}`,
    repo: 'orca',
    branch: `branch-${index}`,
    displayName: `Workspace ${index}`,
    liveTerminalCount: 0,
    status: index < active ? ('working' as const) : ('done' as const)
  }))
  return { ok: true, result: { worktrees } } as RpcResponse
}

function infoStore() {
  let state: Record<string, HostWorktreeInfo> = {}
  return {
    get current() {
      return state
    },
    setInfo(updater: (prev: Record<string, HostWorktreeInfo>) => Record<string, HostWorktreeInfo>) {
      state = updater(state)
    }
  }
}

const notDisposed = () => false

describe('fetchHomeHostWorktreeInfo', () => {
  it('keeps the last proven counts when the in-flight read rejects', async () => {
    const store = infoStore()
    const host = fakeClient()

    const loaded = fetchHomeHostWorktreeInfo(host.client, 'host-1', store.setInfo, notDisposed)
    host.settle(catalogResponse(12, 2))
    await loaded

    const failed = fetchHomeHostWorktreeInfo(host.client, 'host-1', store.setInfo, notDisposed)
    host.settle(new Error('socket closed mid-request'))
    await failed

    expect(store.current['host-1']).toEqual({
      hostId: 'host-1',
      totalWorktrees: 12,
      activeCount: 2,
      lastActiveWorktree: expect.objectContaining({ worktreeId: 'wt-0' }),
      catalogUnavailable: true,
      staleCounts: true
    })
  })

  it('marks a host whose catalog never loaded as unavailable, not empty', async () => {
    const store = infoStore()
    const host = fakeClient()

    const failed = fetchHomeHostWorktreeInfo(host.client, 'host-1', store.setInfo, notDisposed)
    host.settle({ ok: false, error: { code: 'internal' } } as RpcResponse)
    await failed

    expect(store.current['host-1']).toMatchObject({
      totalWorktrees: 0,
      catalogUnavailable: true
    })
    expect(store.current['host-1'].staleCounts).toBeUndefined()
  })

  it('re-reads the catalog on reconnect and clears the stale flag', async () => {
    const store = infoStore()
    const host = fakeClient()
    const gate = createHostConnectRefetchGate()

    const connect = async (response: RpcResponse | Error) => {
      if (!gate.observe('connected')) {
        return
      }
      const done = fetchHomeHostWorktreeInfo(host.client, 'host-1', store.setInfo, notDisposed)
      host.settle(response)
      await done
    }

    await connect(catalogResponse(12, 2))
    // Socket dies mid-poll: counts survive, flagged stale.
    const dropped = fetchHomeHostWorktreeInfo(host.client, 'host-1', store.setInfo, notDisposed)
    host.settle(new Error('socket closed mid-request'))
    await dropped
    gate.observe('reconnecting')
    expect(store.current['host-1'].staleCounts).toBe(true)

    await connect(catalogResponse(13, 3))

    expect(store.current['host-1']).toMatchObject({
      totalWorktrees: 13,
      activeCount: 3
    })
    expect(store.current['host-1'].staleCounts).toBeUndefined()
    expect(store.current['host-1'].catalogUnavailable).toBeUndefined()
    // Two connects + the dropped poll: the gate must not re-read while the link holds.
    expect(host.calls).toBe(3)
    await connect(catalogResponse(13, 3))
    expect(host.calls).toBe(3)
  })

  it('ignores a response that lands after the screen is disposed', async () => {
    const store = infoStore()
    const host = fakeClient()

    const done = fetchHomeHostWorktreeInfo(host.client, 'host-1', store.setInfo, () => true)
    host.settle(new Error('socket closed mid-request'))
    await done

    expect(store.current['host-1']).toBeUndefined()
  })
})
