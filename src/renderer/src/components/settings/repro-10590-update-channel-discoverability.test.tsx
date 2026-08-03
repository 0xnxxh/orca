// @vitest-environment happy-dom

// Repro for #10590: the RC / perf update channels are only announced through a
// native `title` attribute, and that string never goes through i18n.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUpdateCheckHint } from '@/lib/update-check-click-options'

type UpdateState = 'idle' | 'checking' | 'downloading'

let updateState: UpdateState = 'idle'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      settingsSearchQuery: '',
      updateStatus: { state: updateState },
      remoteServerUpdates: new Map(),
      remoteServerUpdatesChecking: false,
      remoteServerUpdatesRunning: false,
      refreshRemoteServerUpdates: vi.fn(),
      setRemoteServerUpdateDialogOpen: vi.fn()
    })
}))

vi.mock('./ReleaseChannelSection', () => ({
  ReleaseChannelSection: () => null
}))

vi.mock('./GeneralRemoteServerUpdates', () => ({
  GeneralRemoteServerUpdates: () => null
}))

import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  updateState = 'idle'
  // @ts-expect-error -- React act() environment flag
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // @ts-expect-error -- minimal preload surface for this component
  window.api = {
    updater: {
      getVersion: () => Promise.resolve('1.4.155'),
      check: vi.fn(),
      download: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

function renderSection(): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<GeneralUpdateSettingsSection />)
  })
  return container
}

function findCheckForUpdatesButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes('Check for Updates')
  )
  if (!button) {
    throw new Error('Check for Updates button not rendered')
  }
  return button as HTMLButtonElement
}

const LOCALE_DIR = resolve(__dirname, '../../i18n/locales')
const LOCALES = ['en', 'zh', 'ja', 'ko', 'es']

describe('#10590 update channel discoverability', () => {
  it('exposes the modifier-click channels as visible text, not only a native title', () => {
    const host = renderSection()
    const button = findCheckForUpdatesButton(host)

    // The hint exists today, but only inside `title`.
    expect(button.getAttribute('title')).toContain('checks the latest RC')

    // Correct behavior: a user who never hovers still learns the channels exist.
    const visibleText = host.textContent ?? ''
    expect(visibleText).toMatch(/latest RC/i)
    expect(visibleText).toMatch(/perf build/i)
  })

  it('keeps the channel hint reachable while a check is in flight', () => {
    updateState = 'checking'
    const host = renderSection()
    const button = findCheckForUpdatesButton(host)

    expect(button.disabled).toBe(true)
    // `disabled:pointer-events-none` on ui/button.tsx suppresses hover, so the
    // native tooltip cannot fire. The hint must live somewhere else.
    const visibleText = host.textContent ?? ''
    expect(visibleText).toMatch(/latest RC/i)
  })

  it('ships the update-channel hint in every locale catalog', () => {
    const hint = getUpdateCheckHint(true)
    const missing: string[] = []

    for (const locale of LOCALES) {
      const catalog = readFileSync(resolve(LOCALE_DIR, `${locale}.json`), 'utf8')
      // The English source string must at minimum exist as a translatable entry.
      if (!catalog.includes('checks the latest RC')) {
        missing.push(locale)
      }
    }

    expect({ hint, missing }).toEqual({ hint, missing: [] })
  })
})
