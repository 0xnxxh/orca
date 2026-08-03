import { describe, expect, it, vi } from 'vitest'
import { RpcApplicationResponsiveness } from './rpc-application-responsiveness'

describe('RpcApplicationResponsiveness subscriptions', () => {
  it('notifies once on latch and once on recovery', () => {
    const responsiveness = new RpcApplicationResponsiveness()
    const listener = vi.fn()
    responsiveness.subscribe(listener)

    responsiveness.recordTimeout('worktree.ps', 100)
    expect(listener).toHaveBeenCalledTimes(1)
    responsiveness.recordTimeout('worktree.ps', 200)
    expect(listener).toHaveBeenCalledTimes(1)

    responsiveness.recordResponse('worktree.ps', 300)
    expect(listener).toHaveBeenCalledTimes(2)
    responsiveness.recordResponse('worktree.ps', 400)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('ignores health-probe traffic and stops after unsubscribe', () => {
    const responsiveness = new RpcApplicationResponsiveness()
    const listener = vi.fn()
    const unsubscribe = responsiveness.subscribe(listener)

    responsiveness.recordTimeout('status.get', 100)
    responsiveness.recordResponse('status.get', 200)
    expect(listener).not.toHaveBeenCalled()
    expect(responsiveness.getUnresponsiveSince()).toBeNull()

    unsubscribe()
    responsiveness.recordTimeout('worktree.ps', 300)
    expect(listener).not.toHaveBeenCalled()
    expect(responsiveness.getUnresponsiveSince()).toBe(300)
  })
})
