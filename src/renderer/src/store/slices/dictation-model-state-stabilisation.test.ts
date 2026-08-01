/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand'
import type { SpeechModelState } from '../../../../shared/speech-types'
import type { AppState } from '../types'
import { createDictationSlice, SPEECH_MODEL_STATE_CHURN_BREADCRUMB } from './dictation'

type DictationTestStore = Pick<AppState, 'modelStates' | 'refreshModelStates' | 'setModelStates'>
const dictationSlice = createDictationSlice as unknown as StateCreator<DictationTestStore>

let reply: SpeechModelState[] = []
let recordBreadcrumb: ReturnType<typeof vi.fn>

// Mirrors CHURN_WINDOW_MS in ./dictation; enough to roll the window.
const PAST_CHURN_WINDOW_MS = 5_001

// Why a fresh store per test: the churn window is per-slice closure state.
function newStore(): UseBoundStore<StoreApi<DictationTestStore>> {
  return create<DictationTestStore>(dictationSlice)
}

// Why pin Date.now: the churn rule is "per window", so a test that lets real time
// pass measures the machine, not the rule.
function pinClock(): { advance: (ms: number) => void } {
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  return {
    advance: (ms) => {
      now += ms
    }
  }
}

function churnBreadcrumbs(): { name: string; data?: Record<string, number> }[] {
  return recordBreadcrumb.mock.calls
    .map((call) => call[0] as { name: string; data?: Record<string, number> })
    .filter((entry) => entry.name === SPEECH_MODEL_STATE_CHURN_BREADCRUMB)
}

beforeEach(() => {
  recordBreadcrumb = vi.fn()
  Object.assign(window, {
    api: {
      crashReports: { recordBreadcrumb },
      // Why a fresh clone per call: structured clone across the bridge never
      // preserves identity, which is the condition the stabilisation exists for.
      speech: { getModelStates: vi.fn(async () => reply.map((state) => ({ ...state }))) }
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dictation model-state stabilisation', () => {
  it('keeps the previous array when every field matches', async () => {
    reply = [{ id: 'whisper-tiny', status: 'downloading', progress: 0.42 }]
    const store = newStore()
    await store.getState().refreshModelStates()
    const first = store.getState().modelStates
    await store.getState().refreshModelStates()

    expect(store.getState().modelStates).toBe(first)
  })

  // Guards the failure mode the stabilisation itself creates: over-holding leaves the
  // Voice pane frozen on a stale download, and no render-pressure ceiling catches it.
  it.each([
    ['progress', { id: 'whisper-tiny', status: 'downloading', progress: 0.43 }],
    ['status', { id: 'whisper-tiny', status: 'ready', progress: 0.42 }],
    ['error', { id: 'whisper-tiny', status: 'downloading', progress: 0.42, error: 'boom' }],
    ['id', { id: 'parakeet-tdt-0.6b-v3-int8', status: 'downloading', progress: 0.42 }]
  ] as [string, SpeechModelState][])('adopts a reply whose %s changed', async (_, changed) => {
    reply = [{ id: 'whisper-tiny', status: 'downloading', progress: 0.42 }]
    const store = newStore()
    await store.getState().refreshModelStates()
    const first = store.getState().modelStates

    reply = [changed]
    await store.getState().refreshModelStates()

    expect(store.getState().modelStates).not.toBe(first)
    expect(store.getState().modelStates).toEqual([changed])
  })

  it('adopts a reply that added a model', async () => {
    reply = [{ id: 'whisper-tiny', status: 'ready' }]
    const store = newStore()
    await store.getState().refreshModelStates()

    reply = [
      { id: 'whisper-tiny', status: 'ready' },
      { id: 'parakeet-tdt-0.6b-v3-int8', status: 'not-downloaded' }
    ]
    await store.getState().refreshModelStates()

    expect(store.getState().modelStates).toHaveLength(2)
  })

  it('applies every step of a whole-percent download', async () => {
    const store = newStore()
    const rendered: (number | undefined)[] = []
    for (let percent = 0; percent <= 90; percent += 1) {
      reply = [{ id: 'whisper-tiny', status: 'downloading', progress: percent / 100 }]
      await store.getState().refreshModelStates()
      rendered.push(store.getState().modelStates[0]?.progress)
    }

    expect(rendered).toEqual(Array.from({ length: 91 }, (_unused, percent) => percent / 100))
  })

  // Main clamps progress at 0.9 and emits per whole percent, so a fast 56MB download
  // puts its whole ~91-refresh run in one window. Firing there would be a false alarm
  // and would evict real evidence from the 30-entry breadcrumb ring.
  it('does not report churn for one healthy download inside a single window', async () => {
    const store = newStore()
    for (let percent = 0; percent <= 90; percent += 1) {
      reply = [{ id: 'whisper-tiny', status: 'downloading', progress: percent / 100 }]
      await store.getState().refreshModelStates()
    }

    expect(recordBreadcrumb).not.toHaveBeenCalled()
  })

  it('reports churn once the renderer is driven far past whole-percent pacing', async () => {
    const store = newStore()
    reply = [{ id: 'whisper-tiny', status: 'downloading', progress: 0.42 }]
    for (let refresh = 0; refresh < 250; refresh += 1) {
      await store.getState().refreshModelStates()
    }

    const churn = churnBreadcrumbs()
    expect(churn).toHaveLength(1)
    expect(churn[0].data).toMatchObject({ refreshes: 250, noOpRefreshes: 249 })
  })

  // Stopping at exactly the threshold cannot tell "fires once" from "fires on every
  // refresh after", and the second floods the 30-entry ring this breadcrumb is
  // coalesced into to protect.
  it('records the churn breadcrumb at most once per window', async () => {
    pinClock()
    const store = newStore()
    reply = [{ id: 'whisper-tiny', status: 'downloading', progress: 0.42 }]
    for (let refresh = 0; refresh < 400; refresh += 1) {
      await store.getState().refreshModelStates()
    }

    expect(churnBreadcrumbs()).toHaveLength(1)
  })

  // The threshold is a rate, not a lifetime total. Without a per-window reset three
  // healthy downloads (3 x 91) cross 250 and the breadcrumb cries wolf again.
  it('counts per window, so healthy downloads never accumulate into a false alarm', async () => {
    const clock = pinClock()
    const store = newStore()
    reply = [{ id: 'whisper-tiny', status: 'downloading', progress: 0.42 }]
    for (let download = 0; download < 4; download += 1) {
      for (let refresh = 0; refresh <= 90; refresh += 1) {
        await store.getState().refreshModelStates()
      }
      clock.advance(PAST_CHURN_WINDOW_MS)
    }

    expect(churnBreadcrumbs()).toEqual([])
  })
})
