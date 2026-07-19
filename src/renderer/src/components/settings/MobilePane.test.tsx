// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

type StoreState = {
  orcaProfileAuthStatus: { state: 'connected' | 'local' }
  settings: {
    mobileAutoRestoreFitMs: number | null
    mobilePairingConnectionMode?: MobilePairingConnectionMode
  }
  updateSettings: (patch: Record<string, unknown>) => Promise<void>
  recordFeatureInteraction: (feature: string) => void
}

const mocks = vi.hoisted(() => {
  const holder: { state: StoreState } = { state: {} as StoreState }
  const useAppStore = Object.assign(
    (selector: (state: StoreState) => unknown) => selector(holder.state),
    { getState: () => holder.state }
  )
  return { holder, useAppStore }
})

vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('../../store', () => ({ useAppStore: mocks.useAppStore }))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('./mobile-pairing-device-polling', () => ({ useMobilePairingDevicePolling: vi.fn() }))

// Stub the child sections so the test targets MobilePane's own connection-mode
// safety wiring (effective mode, canGenerate gate, persistence) in isolation.
vi.mock('./MobilePairingSetupSection', () => ({
  MobilePairingSetupSection: (props: {
    connectionMode: MobilePairingConnectionMode
    canGenerate?: boolean
    connectionPathControl: React.ReactNode
    onGenerateQr: () => void
  }) => (
    <div>
      <span data-testid="mode">{props.connectionMode}</span>
      <span data-testid="can-generate">{String(props.canGenerate)}</span>
      {props.connectionPathControl}
      <button type="button" onClick={props.onGenerateQr}>
        Generate
      </button>
    </div>
  )
}))
vi.mock('./MobilePairingConnectionOptions', () => ({
  MobilePairingConnectionOptions: (props: {
    onChange: (mode: MobilePairingConnectionMode) => void
  }) => (
    <div>
      <button type="button" onClick={() => props.onChange('automatic')}>
        choose-anywhere
      </button>
      <button type="button" onClick={() => props.onChange('local-only')}>
        choose-local
      </button>
    </div>
  )
}))
vi.mock('./MobilePairingQrSection', () => ({ MobilePairingQrSection: () => <div /> }))
vi.mock('./MobilePairedDevicesSection', () => ({ MobilePairedDevicesSection: () => <div /> }))
vi.mock('./MobileAutoRestoreFitSection', () => ({ MobileAutoRestoreFitSection: () => <div /> }))
vi.mock('../mobile/WindowsFirewallNotice', () => ({ WindowsFirewallNotice: () => <div /> }))

import { MobilePane } from './MobilePane'

describe('MobilePane pairing connection mode', () => {
  const getPairingQR = vi.fn()
  const updateSettings = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    getPairingQR.mockReset().mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,qr',
      pairingUrl: 'orca://pair',
      endpoint: 'ws://host'
    })
    updateSettings.mockClear()
    mocks.holder.state = {
      orcaProfileAuthStatus: { state: 'connected' },
      settings: { mobileAutoRestoreFitMs: null },
      updateSettings,
      recordFeatureInteraction: vi.fn()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR,
          listDevices: vi.fn().mockResolvedValue({ devices: [] }),
          listNetworkInterfaces: vi.fn().mockResolvedValue({ interfaces: [] }),
          revokeDevice: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  afterEach(cleanup)

  it('defaults to Anywhere and issues an automatic QR when signed in', async () => {
    const user = userEvent.setup()
    render(<MobilePane />)
    expect(screen.getByTestId('mode')).toHaveTextContent('automatic')
    expect(screen.getByTestId('can-generate')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'automatic' }))
  })

  it('keeps Anywhere selected but issues a local-only QR and blocks generation when signed out', async () => {
    mocks.holder.state.orcaProfileAuthStatus = { state: 'local' }
    const user = userEvent.setup()
    render(<MobilePane />)
    expect(screen.getByTestId('mode')).toHaveTextContent('automatic')
    // Why: the signed-out desktop cannot serve Relay, so Generate is gated off.
    expect(screen.getByTestId('can-generate')).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'local-only' }))
  })

  it('persists the chosen path when the mode changes', async () => {
    const user = userEvent.setup()
    render(<MobilePane />)
    await user.click(screen.getByRole('button', { name: 'choose-local' }))
    expect(updateSettings).toHaveBeenCalledWith({ mobilePairingConnectionMode: 'local-only' })
    expect(screen.getByTestId('mode')).toHaveTextContent('local-only')
  })

  it('restores a saved local-only preference without user interaction', () => {
    mocks.holder.state.settings = {
      mobileAutoRestoreFitMs: null,
      mobilePairingConnectionMode: 'local-only'
    }
    render(<MobilePane />)
    expect(screen.getByTestId('mode')).toHaveTextContent('local-only')
  })
})
