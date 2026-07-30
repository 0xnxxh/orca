// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import type * as ReactModule from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { SkillFreshnessUpdateDialogHost } from './SkillFreshnessUpdateDialogHost'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  getSkillFreshnessUpdateDialogRequest,
  requestSkillFreshnessUpdateDialog,
  subscribeSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'
import { _resetSkillUpdateRunStore } from './skill-update-run-store'

const lazyState = vi.hoisted(() => ({
  loadCalls: 0,
  mounts: 0,
  unmounts: 0,
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
  'src/renderer/src/components/skills/SkillFreshnessUpdateDialogHost.tsx'
)
const NUDGE_PATH = join(process.cwd(), 'src/renderer/src/components/skills/SkillFreshnessNudge.tsx')
const SETTINGS_PATH = join(process.cwd(), 'src/renderer/src/components/settings/Settings.tsx')
const SETTINGS_LOADER_PATH = join(
  process.cwd(),
  'src/renderer/src/components/settings/settings-module-loader.ts'
)

function DialogProbe(): React.JSX.Element {
  const open = useSyncExternalStore(
    subscribeSkillFreshnessUpdateDialog,
    getSkillFreshnessUpdateDialogRequest,
    getSkillFreshnessUpdateDialogRequest
  )
  const [continuity, setContinuity] = useState(0)

  useEffect(() => {
    lazyState.mounts += 1
    return () => {
      lazyState.unmounts += 1
    }
  }, [])

  return (
    <div data-dialog-probe data-open={String(open)} data-continuity={continuity}>
      <button type="button" onClick={() => setContinuity((value) => value + 1)}>
        preserve state
      </button>
    </div>
  )
}

describe('skill freshness update-dialog lazy boundary', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterAll(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    container?.remove()
    consumeSkillFreshnessUpdateDialogRequest()
    _resetSkillUpdateRunStore()
  })

  it('keeps the eager host narrow and inside the link-routing context', () => {
    const appSource = readFileSync(APP_PATH, 'utf8')
    const hostSource = readFileSync(HOST_PATH, 'utf8')
    const nudgeSource = readFileSync(NUDGE_PATH, 'utf8')
    const settingsSource = readFileSync(SETTINGS_PATH, 'utf8')
    const settingsLoaderSource = readFileSync(SETTINGS_LOADER_PATH, 'utf8')
    const providerStart = appSource.indexOf('<LinkRoutingPreferenceDialogProvider>')
    const providerEnd = appSource.indexOf('</LinkRoutingPreferenceDialogProvider>')
    const host = appSource.indexOf('<SkillFreshnessUpdateDialogHost />')
    const nudge = appSource.indexOf('<SkillFreshnessNudge />')

    expect(appSource).toContain(
      "import { SkillFreshnessUpdateDialogHost } from './components/skills/SkillFreshnessUpdateDialogHost'"
    )
    expect(appSource).not.toContain("from './components/skills/SkillFreshnessUpdateDialog'")
    expect(providerStart).toBeGreaterThan(-1)
    expect(host).toBeGreaterThan(providerStart)
    expect(host).toBeLessThan(providerEnd)
    expect(nudge).toBeGreaterThan(providerEnd)
    expect(appSource).toContain('const Settings = lazy(loadSettingsModule)')
    expect(hostSource).toContain('loadSettingsModule().then((module)')
    expect(settingsLoaderSource).toContain("=> import('./Settings')")
    expect(settingsSource).toContain(
      "export { SkillFreshnessUpdateDialog } from '@/components/skills/SkillFreshnessUpdateDialog'"
    )
    expect(hostSource).toContain("{ reloadKey: 'skill-freshness-update-dialog' }")
    expect(hostSource).toContain('<Suspense fallback={null}>')
    expect(hostSource).toContain('useFreshness={useSkillFreshness}')
    expect(hostSource).not.toContain('const state = useSkillFreshness()')
    expect(hostSource).not.toContain('SkillUpdateRow')
    expect(nudgeSource).toContain('const state = useSkillFreshness()')
  })

  it('honors a pre-subscription request, suspends once, and preserves the loaded instance', async () => {
    _resetSkillUpdateRunStore()
    window.api = {
      skills: {
        onUpdateRun: () => () => {},
        getUpdateRun: async () => ({ state: 'idle' })
      }
    } as never
    requestSkillFreshnessUpdateDialog()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<SkillFreshnessUpdateDialogHost />)
    })

    expect(lazyState.loadCalls).toBe(1)
    expect(lazyState.reloadKey).toBe('skill-freshness-update-dialog')
    expect(container.childElementCount).toBe(0)

    await act(async () => {
      lazyState.resolve?.(DialogProbe)
    })
    const probe = container.querySelector('[data-dialog-probe]')
    expect(probe?.getAttribute('data-open')).toBe('true')
    expect(lazyState.mounts).toBe(1)

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      consumeSkillFreshnessUpdateDialogRequest()
    })
    expect(probe?.getAttribute('data-open')).toBe('false')
    expect(probe?.getAttribute('data-continuity')).toBe('1')
    expect(lazyState.unmounts).toBe(0)

    await act(async () => {
      requestSkillFreshnessUpdateDialog()
    })
    expect(container.querySelector('[data-dialog-probe]')).toBe(probe)
    expect(probe?.getAttribute('data-open')).toBe('true')
    expect(probe?.getAttribute('data-continuity')).toBe('1')
    expect(lazyState.loadCalls).toBe(1)
    expect(lazyState.mounts).toBe(1)
  })
})
