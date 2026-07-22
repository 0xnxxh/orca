// @vitest-environment happy-dom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type {
  DeveloperPermissionRequestResult,
  DeveloperPermissionState,
  DeveloperPermissionStatus
} from '../../../../shared/developer-permissions-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  FullDiskAccessNudge,
  resetFullDiskAccessProbeForTests,
  shouldShowFullDiskAccessNudge
} from './FullDiskAccessNudge'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn()
  }
}))

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

function setUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true
  })
}

function installDeveloperPermissionsApi(args: {
  getStatus: () => Promise<DeveloperPermissionState[]>
  request?: () => Promise<DeveloperPermissionRequestResult>
}): { getStatus: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } {
  const getStatus = vi.fn(args.getStatus)
  const request = vi.fn(
    args.request ??
      (async () => ({
        id: 'full-disk-access',
        status: 'unknown',
        openedSystemSettings: true
      }))
  )
  Object.assign(window, { api: { developerPermissions: { getStatus, request } } })
  return { getStatus, request }
}

function fdaStatus(status: DeveloperPermissionStatus): DeveloperPermissionState[] {
  return [{ id: 'full-disk-access', status }]
}

async function renderNudge(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(TooltipProvider, null, React.createElement(FullDiskAccessNudge))
    )
  })
  // Flush the one-shot getStatus() probe microtasks.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return { container, root }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  resetFullDiskAccessProbeForTests()
  try {
    window.localStorage.clear()
  } catch {
    // ignore
  }
})

describe('shouldShowFullDiskAccessNudge', () => {
  it('shows on macOS when Full Disk Access is not yet granted', () => {
    expect(
      shouldShowFullDiskAccessNudge({ isMac: true, dismissed: false, status: 'unknown' })
    ).toBe(true)
  })

  it('hides when granted, ready, unsupported, or unresolved', () => {
    for (const status of ['granted', 'ready', 'unsupported', undefined] as const) {
      expect(shouldShowFullDiskAccessNudge({ isMac: true, dismissed: false, status })).toBe(false)
    }
  })

  it('hides off macOS and when dismissed', () => {
    expect(
      shouldShowFullDiskAccessNudge({ isMac: false, dismissed: false, status: 'unknown' })
    ).toBe(false)
    expect(shouldShowFullDiskAccessNudge({ isMac: true, dismissed: true, status: 'unknown' })).toBe(
      false
    )
  })
})

describe('FullDiskAccessNudge', () => {
  it('renders the ambient card with honest copy when FDA is ungranted on macOS', async () => {
    setUserAgent(MAC_UA)
    installDeveloperPermissionsApi({ getStatus: async () => fdaStatus('unknown') })
    const { container } = await renderNudge()
    expect(container.textContent).toContain('Reduce macOS permission prompts')
    expect(container.textContent).toContain('Full Disk Access')
    expect(container.textContent).toContain('Open System Settings')
  })

  it('stays hidden while the probe is unresolved (no first-paint flash)', async () => {
    setUserAgent(MAC_UA)
    // A never-resolving probe leaves status undefined.
    installDeveloperPermissionsApi({ getStatus: () => new Promise(() => {}) })
    const { container } = await renderNudge()
    expect(container.textContent).toBe('')
  })

  it('hides once Full Disk Access is granted', async () => {
    setUserAgent(MAC_UA)
    installDeveloperPermissionsApi({ getStatus: async () => fdaStatus('granted') })
    const { container } = await renderNudge()
    expect(container.textContent).toBe('')
  })

  it('does not probe permissions off macOS', async () => {
    setUserAgent(WINDOWS_UA)
    const { getStatus } = installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown')
    })
    const { container } = await renderNudge()
    expect(container.textContent).toBe('')
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('stays hidden on the web client whose status list is empty', async () => {
    setUserAgent(MAC_UA)
    installDeveloperPermissionsApi({ getStatus: async () => [] })
    const { container } = await renderNudge()
    expect(container.textContent).toBe('')
  })

  it('opens System Settings via the Full Disk Access request', async () => {
    setUserAgent(MAC_UA)
    const { request } = installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown')
    })
    const { container } = await renderNudge()
    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    expect(openButton).toBeTruthy()
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(request).toHaveBeenCalledWith({ id: 'full-disk-access' })
  })

  it('hides the card when the request reports Full Disk Access was granted', async () => {
    setUserAgent(MAC_UA)
    installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown'),
      request: async () => ({
        id: 'full-disk-access',
        status: 'granted',
        openedSystemSettings: false
      })
    })
    const { container } = await renderNudge()
    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toBe('')
    expect(toast.success).toHaveBeenCalled()
  })

  it('re-enables the action and surfaces an error toast when the request rejects', async () => {
    setUserAgent(MAC_UA)
    installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown'),
      request: async () => {
        throw new Error('ipc failure')
      }
    })
    const { container } = await renderNudge()
    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(toast.error).toHaveBeenCalled()
    // Card stays visible and the button is usable again for a retry.
    const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    expect(retryButton).toBeTruthy()
    expect((retryButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('probes protected data only once even under React StrictMode', async () => {
    setUserAgent(MAC_UA)
    const { getStatus } = installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown')
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(TooltipProvider, null, React.createElement(FullDiskAccessNudge))
        )
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Reduce macOS permission prompts')
  })

  it('hides on return-focus once the grant takes effect after the CTA', async () => {
    setUserAgent(MAC_UA)
    let currentStatus: DeveloperPermissionStatus = 'unknown'
    installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus(currentStatus),
      request: async () => ({
        id: 'full-disk-access',
        status: 'unknown',
        openedSystemSettings: true
      })
    })
    const { container } = await renderNudge()
    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Opening System Settings alone does not grant, so the card stays.
    expect(container.textContent).toContain('Reduce macOS permission prompts')
    // The user grants Full Disk Access in System Settings, then returns to Orca.
    currentStatus = 'granted'
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toBe('')
  })

  it('stops watching for the grant once the card is dismissed', async () => {
    setUserAgent(MAC_UA)
    const { getStatus } = installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown'),
      request: async () => ({
        id: 'full-disk-access',
        status: 'unknown',
        openedSystemSettings: true
      })
    })
    const { container } = await renderNudge()
    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const dismissButton = container.querySelector(
      'button[aria-label="Dismiss Full Disk Access suggestion"]'
    )
    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toBe('')
    const callsAtDismiss = getStatus.mock.calls.length
    // A later window focus must not re-probe protected data after dismissal.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getStatus.mock.calls.length).toBe(callsAtDismiss)
  })

  it('records a granted request result in the session cache even if unmounted mid-request', async () => {
    setUserAgent(MAC_UA)
    let resolveRequest: (result: DeveloperPermissionRequestResult) => void = () => {}
    const pendingRequest = new Promise<DeveloperPermissionRequestResult>((resolve) => {
      resolveRequest = resolve
    })
    installDeveloperPermissionsApi({
      getStatus: async () => fdaStatus('unknown'),
      request: () => pendingRequest
    })
    const { container, root } = await renderNudge()
    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open System Settings')
    )
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      root.unmount()
    })
    await act(async () => {
      resolveRequest({ id: 'full-disk-access', status: 'granted', openedSystemSettings: false })
      await Promise.resolve()
      await Promise.resolve()
    })
    // A fresh mount reads the updated session cache and stays hidden (granted).
    installDeveloperPermissionsApi({ getStatus: async () => fdaStatus('unknown') })
    const remount = await renderNudge()
    expect(remount.container.textContent).toBe('')
  })

  it('dismisses immediately, persists, and does not re-probe after remount', async () => {
    setUserAgent(MAC_UA)
    const first = installDeveloperPermissionsApi({ getStatus: async () => fdaStatus('unknown') })
    const rendered = await renderNudge()
    const dismissButton = rendered.container.querySelector(
      'button[aria-label="Dismiss Full Disk Access suggestion"]'
    )
    expect(dismissButton).toBeTruthy()
    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(rendered.container.textContent).toBe('')
    expect(window.localStorage.getItem('orca.fullDiskAccessNudgeDismissed.v1')).toBe('1')

    // Remounting after a permanent dismissal must not render or re-probe.
    const second = installDeveloperPermissionsApi({ getStatus: async () => fdaStatus('unknown') })
    const remounted = await renderNudge()
    expect(remounted.container.textContent).toBe('')
    expect(second.getStatus).not.toHaveBeenCalled()
    expect(first.getStatus).toHaveBeenCalledTimes(1)
  })

  it('dismisses for the session even when persistence throws', async () => {
    setUserAgent(MAC_UA)
    installDeveloperPermissionsApi({ getStatus: async () => fdaStatus('unknown') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const { container } = await renderNudge()
    const dismissButton = container.querySelector(
      'button[aria-label="Dismiss Full Disk Access suggestion"]'
    )
    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toBe('')
  })
})
