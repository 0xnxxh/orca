import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyStartupIngress, type PtyIngressEmission } from './pty-startup-ingress'

const COLORS = { foreground: '#2e3434', background: '#ffffff' }
const FOREGROUND_REPLY = '\x1b]10;rgb:2e2e/3434/3434\x1b\\'
const BACKGROUND_REPLY = '\x1b]11;rgb:ffff/ffff/ffff\x1b\\'

function visible(emissions: readonly PtyIngressEmission[]): string {
  return emissions.map((emission) => emission.data).join('')
}

describe('PtyStartupIngress live OSC 10/11 answers', () => {
  afterEach(() => vi.useRealTimers())

  it('answers a post-startup OSC 11 query and strips it from forwarded output', async () => {
    vi.useFakeTimers()
    const emissions: PtyIngressEmission[] = []
    const writes: string[] = []
    const ingress = new PtyStartupIngress({
      liveOscColors: COLORS,
      write: (data) => writes.push(data),
      onEmission: (emission) => emissions.push(emission)
    })
    // gh auth login writes OSC 11 (ST) plus CPR, then survey-reads stdin.
    ingress.accept('\x1b]11;?\x1b\\\x1b[6n')
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([BACKGROUND_REPLY])
    expect(visible(emissions)).toBe('\x1b[6n')
    ingress.accept('\x1b]11;?\x07prompt')
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([BACKGROUND_REPLY, BACKGROUND_REPLY])
    expect(visible(emissions)).toBe('\x1b[6nprompt')
    ingress.drainAndClose()
  })

  it('still answers live OSC 11 after startup query authority expires', async () => {
    vi.useFakeTimers()
    const emissions: PtyIngressEmission[] = []
    const writes: string[] = []
    const ingress = new PtyStartupIngress({
      intent: { colors: COLORS, deadlineMs: 5_000 },
      liveOscColors: COLORS,
      write: (data) => writes.push(data),
      onEmission: (emission) => emissions.push(emission)
    })
    ingress.accept('\x1b]10;?\x07\x1b]11;?\x07')
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([FOREGROUND_REPLY, BACKGROUND_REPLY])
    await vi.advanceTimersByTimeAsync(5_000)
    writes.length = 0
    ingress.accept('\x1b]11;?\x1b\\')
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toEqual([BACKGROUND_REPLY])
    expect(visible(emissions)).toBe('')
    ingress.drainAndClose()
  })
})
