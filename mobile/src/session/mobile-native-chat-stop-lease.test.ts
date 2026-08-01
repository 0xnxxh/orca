import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireMobileNativeChatStopLease,
  resetMobileNativeChatStopLeasesForTests,
  waitForMobileNativeChatStopLease
} from './mobile-native-chat-stop-lease'

describe('mobile native-chat Stop lease', () => {
  afterEach(resetMobileNativeChatStopLeasesForTests)

  async function flushLeaseWaiters(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  it('admits one Stop per terminal and releases queued writers together', async () => {
    const lease = acquireMobileNativeChatStopLease('terminal-1')
    const firstWriter = vi.fn()
    const secondWriter = vi.fn()

    expect(lease).not.toBeNull()
    expect(acquireMobileNativeChatStopLease('terminal-1')).toBeNull()
    void waitForMobileNativeChatStopLease('terminal-1').then(firstWriter)
    void waitForMobileNativeChatStopLease('terminal-1').then(secondWriter)
    await Promise.resolve()
    expect(firstWriter).not.toHaveBeenCalled()
    expect(secondWriter).not.toHaveBeenCalled()

    lease?.release()
    await flushLeaseWaiters()
    expect(firstWriter).toHaveBeenCalledOnce()
    expect(secondWriter).toHaveBeenCalledOnce()
  })

  it('scopes Stop ownership per terminal', async () => {
    const lease = acquireMobileNativeChatStopLease('terminal-1')

    await expect(waitForMobileNativeChatStopLease('terminal-2')).resolves.toBeUndefined()
    lease?.release()
  })

  it('does not let a stale release retire a successor lease', async () => {
    const first = acquireMobileNativeChatStopLease('terminal-1')
    first?.release()
    const second = acquireMobileNativeChatStopLease('terminal-1')
    const writer = vi.fn()
    void waitForMobileNativeChatStopLease('terminal-1').then(writer)

    first?.release()
    await flushLeaseWaiters()
    expect(writer).not.toHaveBeenCalled()

    second?.release()
    await flushLeaseWaiters()
    expect(writer).toHaveBeenCalledOnce()
  })
})
