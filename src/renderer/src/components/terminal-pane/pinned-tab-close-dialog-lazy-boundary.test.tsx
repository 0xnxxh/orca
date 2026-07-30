// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useEffect, useState, type ComponentType } from 'react'
import type * as ReactModule from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import PinnedTabCloseDialogHost from './PinnedTabCloseDialogHost'

const initialState = useAppStore.getInitialState()
const mountedRoots: Root[] = []
const lazyState = vi.hoisted(() => ({
  loadCalls: 0,
  mounts: 0,
  reloadKey: '',
  resolve: null as null | ((component: ComponentType) => void)
}))

vi.mock('@/lib/lazy-with-retry', async () => {
  const react = await vi.importActual<typeof ReactModule>('react')
  return {
    lazyWithRetry: (
      _factory: () => Promise<{ default: ComponentType }>,
      options?: { reloadKey?: string }
    ) => {
      lazyState.reloadKey = options?.reloadKey ?? ''
      return react.lazy(() => {
        lazyState.loadCalls += 1
        return new Promise<{ default: ComponentType }>((resolve) => {
          lazyState.resolve = (component) => resolve({ default: component })
        })
      })
    }
  }
})

const APP_PATH = join(process.cwd(), 'src/renderer/src/App.tsx')
const HOST_PATH = join(
  process.cwd(),
  'src/renderer/src/components/terminal-pane/PinnedTabCloseDialogHost.tsx'
)
const SETTINGS_PATH = join(process.cwd(), 'src/renderer/src/components/settings/Settings.tsx')
const SETTINGS_LOADER_PATH = join(
  process.cwd(),
  'src/renderer/src/components/settings/settings-module-loader.ts'
)

function DialogProbe(): React.JSX.Element {
  const request = useAppStore((state) => state.pinnedTabCloseConfirm)
  const [continuity, setContinuity] = useState(0)

  useEffect(() => {
    lazyState.mounts += 1
  }, [])

  return (
    <div data-dialog-probe data-open={String(request !== null)} data-continuity={continuity}>
      <button type="button" onClick={() => setContinuity((value) => value + 1)}>
        preserve state
      </button>
    </div>
  )
}

describe('pinned-tab close-dialog lazy boundary', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
    useAppStore.setState(initialState, true)
  })

  afterAll(() => {
    lazyState.resolve = null
  })

  it('keeps the eager host narrow at the existing App placement', () => {
    const appSource = readFileSync(APP_PATH, 'utf8')
    const hostSource = readFileSync(HOST_PATH, 'utf8')
    const settingsSource = readFileSync(SETTINGS_PATH, 'utf8')
    const settingsLoaderSource = readFileSync(SETTINGS_LOADER_PATH, 'utf8')
    const toaster = appSource.indexOf('<Toaster closeButton')
    const nudge = appSource.indexOf('<SkillFreshnessNudge />')
    const host = appSource.indexOf('<PinnedTabCloseDialogHost />')
    const windowControls = appSource.indexOf('{hasCustomTitleBar && <WindowControls />}')

    expect(appSource).toContain(
      "import PinnedTabCloseDialogHost from './components/terminal-pane/PinnedTabCloseDialogHost'"
    )
    expect(appSource).not.toContain("from './components/terminal-pane/PinnedTabCloseDialog'")
    expect(host).toBeGreaterThan(toaster)
    expect(host).toBeGreaterThan(nudge)
    expect(host).toBeLessThan(windowControls)
    expect(hostSource).toContain('state.pinnedTabCloseConfirm !== null')
    expect(hostSource).toContain('loadSettingsModule().then((module)')
    expect(hostSource).toContain("{ reloadKey: 'pinned-tab-close-dialog' }")
    expect(hostSource).toContain('<Suspense fallback={null}>')
    expect(settingsLoaderSource).toContain("=> import('./Settings')")
    expect(settingsSource).toContain(
      "export { default as PinnedTabCloseDialog } from '@/components/terminal-pane/PinnedTabCloseDialog'"
    )
  })

  it('does not load while the durable request is null', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push(root)

    await act(async () => {
      root.render(<PinnedTabCloseDialogHost />)
    })

    expect(lazyState.loadCalls).toBe(0)
    expect(container.childElementCount).toBe(0)
  })

  it('loads a preexisting request once and preserves the mounted instance across reopen', async () => {
    useAppStore.getState().requestPinnedTabCloseConfirm({
      tabLabel: 'Docs',
      onConfirm: vi.fn()
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push(root)

    await act(async () => {
      root.render(<PinnedTabCloseDialogHost />)
    })

    expect(lazyState.loadCalls).toBe(1)
    expect(lazyState.reloadKey).toBe('pinned-tab-close-dialog')
    expect(container.childElementCount).toBe(0)

    await act(async () => {
      lazyState.resolve?.(DialogProbe)
    })
    const probe = container.querySelector('[data-dialog-probe]')
    expect(probe?.getAttribute('data-open')).toBe('true')
    expect(lazyState.mounts).toBe(1)

    await act(async () => {
      container.querySelector('button')?.click()
      useAppStore.getState().dismissPinnedTabClose()
    })
    expect(probe?.getAttribute('data-open')).toBe('false')
    expect(probe?.getAttribute('data-continuity')).toBe('1')

    await act(async () => {
      useAppStore.getState().requestPinnedTabCloseConfirm({
        tabLabel: 'Console',
        onConfirm: vi.fn()
      })
    })
    expect(container.querySelector('[data-dialog-probe]')).toBe(probe)
    expect(probe?.getAttribute('data-open')).toBe('true')
    expect(probe?.getAttribute('data-continuity')).toBe('1')
    expect(lazyState.loadCalls).toBe(1)
    expect(lazyState.mounts).toBe(1)
  })
})
