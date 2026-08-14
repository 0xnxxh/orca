import { describe, expect, it, vi } from 'vitest'
import { requestGitStreamable } from './ssh-git-response-stream-reader'
import { SshChannelMultiplexer, type MultiplexerTransport } from './ssh-channel-multiplexer'

function createMockTransport(): MultiplexerTransport {
  return {
    write: () => {},
    onData: () => {},
    onClose: () => {}
  }
}

describe('requestGitStreamable on an already-dead multiplexer', () => {
  it('rejects as a transient relay loss and leaves no listener on the caller signal', async () => {
    const mux = new SshChannelMultiplexer(createMockTransport())
    mux.dispose('connection_lost')
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(
      requestGitStreamable(mux, 'git.status', { cwd: '/repo' }, { signal: controller.signal })
    ).rejects.toThrow('SSH connection lost, reconnecting...')

    // #11953: a disposed mux fails synchronously inside onDispose, so the abort
    // listener must already be registered when that cleanup runs — otherwise it
    // outlives the request for the lifetime of the caller's signal.
    expect(removeListener).toHaveBeenCalledTimes(addListener.mock.calls.length)
  })
})

function createFakeMux(marker: { streamId: number; totalBytes: number; chunkCount: number }) {
  const chunkHandlers: ((p: Record<string, unknown>) => void)[] = []
  const notify = vi.fn()
  return {
    notify,
    chunkHandlers,
    mux: {
      request: async () => ({ __orcaGitResponseStream: marker }),
      onNotificationByMethod: (method: string, handler: (p: Record<string, unknown>) => void) => {
        if (method === 'git.responseChunk') {
          chunkHandlers.push(handler)
        }
        return () => {}
      },
      onDispose: () => () => {},
      isDisposed: () => false,
      notify
    } as unknown as SshChannelMultiplexer
  }
}

// Why: without the marker gate the host Buffer.concats and JSON.parses whatever the relay declares,
// so an oversized or hostile response is reassembled in full before anything can reject it.
describe('requestGitStreamable reassembly cap', () => {
  it('rejects an over-cap stream at the marker and cancels it before any chunk transfers', async () => {
    const { mux, notify } = createFakeMux({
      streamId: 7,
      totalBytes: 64 * 1024 * 1024,
      chunkCount: 1
    })

    await expect(requestGitStreamable(mux, 'git.diff', { cwd: '/repo' })).rejects.toThrow(
      /above the \d+ byte cap/
    )
    // Tell the relay to stop sending rather than draining a payload we rejected.
    expect(notify).toHaveBeenCalledWith('git.cancelResponseStream', { streamId: 7 })
    // No chunk was acked, i.e. none was accepted.
    expect(notify).not.toHaveBeenCalledWith('git.responseAck', expect.anything())
  })

  it('admits a stream declared exactly at the cap', async () => {
    const payload = Buffer.from(JSON.stringify({ kind: 'text' }), 'utf-8')
    const { mux, chunkHandlers } = createFakeMux({
      streamId: 8,
      totalBytes: payload.length,
      chunkCount: 1
    })

    const settled = vi.fn()
    void requestGitStreamable(mux, 'git.diff', { cwd: '/repo' }, { maxBytes: payload.length }).then(
      settled,
      settled
    )
    await Promise.resolve()
    await Promise.resolve()

    // The marker passed the gate: a chunk subscriber is live and nothing rejected.
    expect(chunkHandlers).toHaveLength(1)
    expect(settled).not.toHaveBeenCalled()
  })
})
