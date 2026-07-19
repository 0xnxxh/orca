// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

type StoreState = {
  closeMobilePage: () => void
  orcaProfileAuthStatus: { state: 'connected' | 'local' }
  settings: { showMobileButton: boolean; mobilePairingConnectionMode?: MobilePairingConnectionMode }
  updateSettings: () => Promise<void>
}

const mocks = vi.hoisted(() => ({
  storeState: {} as StoreState
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: StoreState) => unknown) => selector(mocks.storeState)
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() }
}))

vi.mock('./use-mobile-install-qr', () => ({ useMobileInstallQr: () => null }))
vi.mock('./use-mobile-page-escape', () => ({ useMobilePageEscape: vi.fn() }))
vi.mock('../settings/mobile-pairing-device-polling', () => ({
  useMobilePairingDevicePolling: vi.fn()
}))

vi.mock('./MobilePageContent', () => ({
  MobilePageContent: (props: {
    connectionMode: MobilePairingConnectionMode
    enterFlow: () => void
    handleConnectionModeChange: (mode: MobilePairingConnectionMode) => void
    handleContinue: () => void
    pairQrDataUrl: string | null
    pairingUrl: string | null
    stage: string | null
    stepIdx: number
  }) => (
    <div>
      <span data-testid="stage">{props.stage ?? 'loading'}</span>
      <span data-testid="step">{props.stepIdx}</span>
      <span data-testid="mode">{props.connectionMode}</span>
      <span data-testid="pairing-qr">{props.pairQrDataUrl ?? 'none'}</span>
      <span data-testid="pairing-url">{props.pairingUrl ?? 'none'}</span>
      <button type="button" onClick={props.enterFlow}>
        Enter flow
      </button>
      <button type="button" onClick={props.handleContinue}>
        Continue
      </button>
      <button type="button" onClick={() => props.handleConnectionModeChange('automatic')}>
        Orca Relay
      </button>
      <button type="button" onClick={() => props.handleConnectionModeChange('local-only')}>
        Local network
      </button>
    </div>
  )
}))

import MobilePage from './MobilePage'

describe('MobilePage pairing connection mode', () => {
  const getPairingQR = vi.fn()

  beforeEach(() => {
    getPairingQR.mockReset().mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,qr',
      pairingUrl: 'orca://pair#automatic'
    })
    mocks.storeState = {
      closeMobilePage: vi.fn(),
      orcaProfileAuthStatus: { state: 'connected' },
      settings: { showMobileButton: true },
      updateSettings: vi.fn().mockResolvedValue(undefined)
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        mobile: {
          getPairingQR,
          listDevices: vi.fn().mockResolvedValue({ devices: [] }),
          listNetworkInterfaces: vi.fn().mockResolvedValue({ interfaces: [] })
        },
        shell: { openUrl: vi.fn() },
        ui: { writeClipboardText: vi.fn().mockResolvedValue(undefined) }
      }
    })
  })

  afterEach(cleanup)

  async function openPairingStep(): Promise<void> {
    const user = userEvent.setup()
    render(<MobilePage />)
    await waitFor(() => expect(screen.getByTestId('stage')).toHaveTextContent('intro'))
    await user.click(screen.getByRole('button', { name: 'Enter flow' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('defaults signed-in pairing to Anywhere and rotates when same-network is selected', async () => {
    const user = userEvent.setup()
    await openPairingStep()

    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'automatic' }))
    await waitFor(() => expect(screen.getByTestId('pairing-qr')).toHaveTextContent('base64,qr'))
    expect(screen.getByTestId('mode')).toHaveTextContent('automatic')

    let resolveRotatedLocalQr: ((value: Record<string, unknown>) => void) | undefined
    getPairingQR.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRotatedLocalQr = resolve
        })
    )
    await user.click(screen.getByRole('button', { name: 'Local network' }))
    await waitFor(() =>
      expect(getPairingQR).toHaveBeenLastCalledWith({
        connectionMode: 'local-only',
        rotate: true
      })
    )
    expect(screen.getByTestId('mode')).toHaveTextContent('local-only')
    expect(screen.getByTestId('pairing-qr')).toHaveTextContent('base64,qr')
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('none')
    expect(mocks.storeState.updateSettings).toHaveBeenCalledWith({
      mobilePairingConnectionMode: 'local-only'
    })

    resolveRotatedLocalQr?.({
      available: true,
      qrDataUrl: 'data:image/png;base64,local-qr',
      pairingUrl: 'orca://pair#local'
    })
    await waitFor(() => expect(screen.getByTestId('pairing-qr')).toHaveTextContent('local-qr'))
  })

  it('restores a saved local-only preference without user interaction', async () => {
    mocks.storeState.settings = {
      showMobileButton: true,
      mobilePairingConnectionMode: 'local-only'
    }
    await openPairingStep()

    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'local-only' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('local-only')
  })

  it('defaults signed-out UI to Orca Relay but only issues a local-only QR', async () => {
    mocks.storeState.orcaProfileAuthStatus = { state: 'local' }
    await openPairingStep()

    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'local-only' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('automatic')
  })

  it('re-mints with Relay when signing in upgrades a local-only fallback QR', async () => {
    mocks.storeState.orcaProfileAuthStatus = { state: 'local' }
    const user = userEvent.setup()
    const { rerender } = render(<MobilePage />)
    await waitFor(() => expect(screen.getByTestId('stage')).toHaveTextContent('intro'))
    await user.click(screen.getByRole('button', { name: 'Enter flow' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Signed-out Step 2 auto-mints local-only while Orca Relay stays selected.
    await waitFor(() => expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'local-only' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('automatic')
    getPairingQR.mockClear()

    // Signing in must upgrade the displayed code from local-only to Relay.
    mocks.storeState.orcaProfileAuthStatus = { state: 'connected' }
    rerender(<MobilePage />)

    await waitFor(() =>
      expect(getPairingQR).toHaveBeenCalledWith({ connectionMode: 'automatic', rotate: true })
    )
    expect(screen.getByTestId('mode')).toHaveTextContent('automatic')
  })

  it('removes the old QR if policy rotation fails', async () => {
    const user = userEvent.setup()
    await openPairingStep()
    await waitFor(() => expect(screen.getByTestId('pairing-qr')).toHaveTextContent('base64,qr'))

    getPairingQR.mockRejectedValueOnce(new Error('rotation failed'))
    await user.click(screen.getByRole('button', { name: 'Local network' }))

    await waitFor(() => expect(screen.getByTestId('pairing-qr')).toHaveTextContent('none'))
    expect(screen.getByTestId('pairing-url')).toHaveTextContent('none')
  })
})
