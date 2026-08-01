/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create, type StateCreator } from 'zustand'
import type { SpeechModelManifest, SpeechModelState } from '../../../../shared/speech-types'
import type { GlobalSettings } from '../../../../shared/types'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import {
  createDictationSlice,
  SPEECH_MODEL_STATE_CHURN_BREADCRUMB
} from '../../store/slices/dictation'
import type { AppState } from '../../store/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DictationTestStore = Pick<
  AppState,
  'modelStates' | 'refreshModelStates' | 'setModelStates' | 'dictationState'
>

// Why: drive the production dictation slice so modelStates identity churn is real, not modelled.
const dictationSlice = createDictationSlice as unknown as StateCreator<DictationTestStore>
const useDictationTestStore = create<DictationTestStore>(dictationSlice)
const initialDictationState = useDictationTestStore.getState()

vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: DictationTestStore) => T): T =>
    useDictationTestStore(selector)
}))

vi.mock('@/hooks/useShortcutLabel', () => ({ useShortcutLabel: () => 'Ctrl+Shift+Y' }))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

const MODEL_ID = 'whisper-small'
const CATALOG_ENTRY: SpeechModelManifest = {
  id: MODEL_ID,
  label: 'Whisper Small',
  description: 'Local streaming model',
  type: 'whisper',
  provider: 'local',
  language: 'en',
  sizeBytes: 500_000_000,
  sampleRate: 16_000,
  streaming: true,
  recommended: true
}

let emitDownloadProgress: ((payload: { modelId: string; progress: number }) => void) | null = null
let reportedProgress = 0

function installWindowApi(): void {
  Object.assign(window, {
    api: {
      developerPermissions: { request: vi.fn() },
      crashReports: { recordBreadcrumb: vi.fn() },
      speech: {
        getCatalog: vi.fn(async () => [{ ...CATALOG_ENTRY }]),
        getOpenAiApiKeyStatus: vi.fn(async () => ({ configured: false })),
        saveOpenAiApiKey: vi.fn(async () => ({ configured: true })),
        clearOpenAiApiKey: vi.fn(async () => ({ configured: false })),
        // Why: every IPC reply is a fresh array, exactly like structured clone across the bridge.
        getModelStates: vi.fn(
          async (): Promise<SpeechModelState[]> => [
            { id: MODEL_ID, status: 'downloading', progress: reportedProgress }
          ]
        ),
        downloadModel: vi.fn(async () => {}),
        deleteModel: vi.fn(async () => {}),
        onDownloadProgress: vi.fn(
          (callback: (payload: { modelId: string; progress: number }) => void) => {
            emitDownloadProgress = callback
            return () => {
              emitDownloadProgress = null
            }
          }
        )
      }
    }
  })
}

// Why: Radix Popper/DismissableLayer need DOM APIs happy-dom does not implement.
function installDomShims(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )
  Element.prototype.hasPointerCapture ??= (): boolean => false
  Element.prototype.setPointerCapture ??= (): void => {}
  Element.prototype.releasePointerCapture ??= (): void => {}
  Element.prototype.scrollIntoView ??= (): void => {}
}

let root: Root

beforeEach(() => {
  reportedProgress = 0
  emitDownloadProgress = null
  useDictationTestStore.setState(initialDictationState, true)
  installWindowApi()
  installDomShims()
})

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/**
 * Renders the real VoicePane with the speech-model dropdown open — the state a
 * download deliberately leaves the menu in — and replays a download-progress
 * burst, counting how many times modelStates subscribers are forced to re-render.
 */
async function runDownloadProgressBurst(events: number): Promise<number> {
  const { VoicePane } = await import('./VoicePane')
  let subscriberRenders = 0

  function ModelStatesSubscriber(): null {
    // Mirrors how VoicePane and the open menu read the store.
    useDictationTestStore((state) => state.modelStates)
    subscriberRenders += 1
    return null
  }

  const settings = {
    voice: { ...getDefaultVoiceSettings(), enabled: true, sttModel: '' }
  } as GlobalSettings

  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <>
        <VoicePane settings={settings} updateSettings={vi.fn()} />
        <ModelStatesSubscriber />
      </>
    )
  })

  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  if (!trigger) {
    throw new Error('speech model dropdown trigger was not rendered')
  }
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
    }
    await Promise.resolve()
  })
  if (!document.querySelector('[role="menu"]')) {
    throw new Error('speech model dropdown did not open')
  }

  const rendersBeforeBurst = subscriberRenders
  for (let index = 0; index < events; index += 1) {
    // Mirrors what main now returns: getModelState quantises the polled reply, so
    // raw sub-percent progress never reaches the renderer. Without that, this mock
    // would flatter the renderer-side stabilisation it is meant to measure.
    reportedProgress = Math.floor((index / events) * 100) / 100
    await act(async () => {
      emitDownloadProgress?.({ modelId: MODEL_ID, progress: reportedProgress })
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  return subscriberRenders - rendersBeforeBurst
}

describe('speech model download progress storm (render pressure)', () => {
  it('does not re-render the open speech-model menu once per download chunk', async () => {
    // A 500MB model over a 64KB chunk stream emits thousands of these; the menu
    // stays open by design while a download runs, so each one re-renders the
    // whole Radix portal/Presence tree the #185 reports crashed inside.
    const EVENTS = 200
    const renders = await runDownloadProgressBurst(EVENTS)

    // 200 chunks carry 100 distinct whole percents and the mount refresh already
    // applied the first, so exactly 99 of these are real work. Asserting the floor
    // too: over-holding freezes the progress bar, which a ceiling alone calls a pass.
    expect(renders).toBe(99)
    expect(useDictationTestStore.getState().modelStates[0]?.progress).toBe(reportedProgress)
  })

  it('records the churn breadcrumb when refreshes outrun coalescing', async () => {
    // Own store instance: the churn window is per-slice state the other tests advance.
    const churnStore = create<DictationTestStore>(dictationSlice)
    for (let refresh = 0; refresh < 250; refresh += 1) {
      await churnStore.getState().refreshModelStates()
    }

    const recordBreadcrumb = window.api.crashReports.recordBreadcrumb as ReturnType<typeof vi.fn>
    const churn = recordBreadcrumb.mock.calls
      .map((call) => call[0] as { name: string; data?: Record<string, number> })
      .find((entry) => entry.name === SPEECH_MODEL_STATE_CHURN_BREADCRUMB)
    expect(churn?.data).toMatchObject({ refreshes: 250, noOpRefreshes: 249 })
    // Registered in COALESCED/NAME_ONLY sets in src/main/ipc/crash-reporting.ts.
    expect(SPEECH_MODEL_STATE_CHURN_BREADCRUMB).toBe('speech_model_state_churn')
  })
})
