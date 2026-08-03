import { describe, expect, it, vi } from 'vitest'
import {
  appendBufferedDictation,
  insertLiveDictationTranscript,
  routeDictationTranscript
} from './terminal-live-dictation-routing'

describe('terminal live dictation routing', () => {
  it('routes to a direct live insert when live input is active', () => {
    expect(routeDictationTranscript('hello world', true)).toEqual({
      kind: 'live-insert',
      text: 'hello world'
    })
  })

  it('routes to buffered append when live input is inactive', () => {
    expect(routeDictationTranscript('hello world', false)).toEqual({
      kind: 'buffered-append',
      text: 'hello world'
    })
  })

  it('replaces an empty or whitespace-only buffered field', () => {
    expect(appendBufferedDictation('', 'spoken')).toBe('spoken')
    expect(appendBufferedDictation('   ', 'spoken')).toBe('spoken')
  })

  it('appends after existing buffered text with one separating space', () => {
    expect(appendBufferedDictation('ls -la', 'in src')).toBe('ls -la in src')
    expect(appendBufferedDictation('ls -la   ', 'in src')).toBe('ls -la in src')
  })

  it('surfaces a canceled completed transcript instead of dropping it silently', async () => {
    const sendInput = vi.fn(async () => true)
    const showToast = vi.fn()

    await expect(
      insertLiveDictationTranscript({
        handle: 'terminal-a',
        onSendError: vi.fn(),
        runTerminalLiveExternalInput: async () => false,
        sendInput,
        showToast,
        text: 'dictated text'
      })
    ).resolves.toBe(false)

    expect(sendInput).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Dictation insert canceled', 1500)
  })

  it('routes concurrent transcript sends through the external-input queue', async () => {
    const pending: Array<{
      operation: () => Promise<boolean>
      resolve: (sent: boolean) => void
    }> = []
    const runTerminalLiveExternalInput = vi.fn(
      async (_handle: string, operation: () => Promise<boolean>) =>
        new Promise<boolean>((resolve) => pending.push({ operation, resolve }))
    )
    const sendInput = vi.fn(async () => true)
    const showToast = vi.fn()
    const insert = (text: string): Promise<boolean> =>
      insertLiveDictationTranscript({
        handle: 'terminal-a',
        onSendError: vi.fn(),
        runTerminalLiveExternalInput,
        sendInput,
        showToast,
        text
      })

    const inserts = [insert('first'), insert('second')]
    await vi.waitFor(() => expect(runTerminalLiveExternalInput).toHaveBeenCalledTimes(2))
    expect(sendInput).not.toHaveBeenCalled()

    for (const queued of pending) {
      queued.resolve(await queued.operation())
    }

    await expect(Promise.all(inserts)).resolves.toEqual([true, true])
    expect(sendInput.mock.calls).toEqual([
      ['terminal-a', 'first'],
      ['terminal-a', 'second']
    ])
  })
})
