import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { DictationState, SpeechModelState } from '../../../../shared/speech-types'
import { recordRendererCrashBreadcrumb } from '../../lib/crash-breadcrumb-recorder'

export const SPEECH_MODEL_STATE_CHURN_BREADCRUMB = 'speech_model_state_churn'
// Why: a whole-percent download emits ~100 refreshes total; anything past this in
// one window means the coalescing upstream stopped holding and the renderer is
// being driven per HTTP chunk again — the shape that starves React's commit loop.
const CHURN_WINDOW_MS = 5_000
const CHURN_REFRESH_THRESHOLD = 60

export type DictationSlice = {
  dictationState: DictationState
  partialTranscript: string
  activeModelId: string | null
  modelStates: SpeechModelState[]
  setDictationState: (state: DictationState) => void
  setPartialTranscript: (text: string) => void
  setActiveModelId: (id: string | null) => void
  setModelStates: (states: SpeechModelState[]) => void
  refreshModelStates: () => Promise<void>
}

function sameSpeechModelState(a: SpeechModelState, b: SpeechModelState): boolean {
  return a.id === b.id && a.status === b.status && a.progress === b.progress && a.error === b.error
}

// Why: every getModelStates reply is a fresh array, so without this each no-op
// refresh re-renders every subscriber — including the open speech-model menu.
function resolveModelStates(
  previous: SpeechModelState[],
  next: SpeechModelState[]
): SpeechModelState[] {
  if (previous.length !== next.length) {
    return next
  }
  return previous.every((state, index) => sameSpeechModelState(state, next[index]))
    ? previous
    : next
}

export const createDictationSlice: StateCreator<AppState, [], [], DictationSlice> = (set) => {
  let windowStartedAt = 0
  let refreshes = 0
  let noOpRefreshes = 0

  // Why: all four page.settings React #185 reports crashed inside the open speech-model
  // menu with no speech telemetry in the bundle. Record the refresh rate so the next
  // occurrence says whether model-state churn was driving the commit storm.
  const noteRefresh = (changed: boolean): void => {
    const now = Date.now()
    if (now - windowStartedAt > CHURN_WINDOW_MS) {
      windowStartedAt = now
      refreshes = 0
      noOpRefreshes = 0
    }
    refreshes += 1
    if (!changed) {
      noOpRefreshes += 1
    }
    if (refreshes === CHURN_REFRESH_THRESHOLD) {
      recordRendererCrashBreadcrumb(SPEECH_MODEL_STATE_CHURN_BREADCRUMB, {
        refreshes,
        noOpRefreshes,
        windowMs: now - windowStartedAt
      })
    }
  }

  return {
    dictationState: 'idle',
    partialTranscript: '',
    activeModelId: null,
    modelStates: [],

    setDictationState: (state) => set({ dictationState: state }),
    setPartialTranscript: (text) => set({ partialTranscript: text }),
    setActiveModelId: (id) => set({ activeModelId: id }),
    setModelStates: (states) =>
      set((prev) => ({ modelStates: resolveModelStates(prev.modelStates, states) })),

    refreshModelStates: async () => {
      try {
        const states = await window.api.speech.getModelStates()
        let changed = false
        set((prev) => {
          const resolved = resolveModelStates(prev.modelStates, states)
          changed = resolved !== prev.modelStates
          return { modelStates: resolved }
        })
        noteRefresh(changed)
      } catch (err) {
        console.error('Failed to fetch model states:', err)
      }
    }
  }
}
