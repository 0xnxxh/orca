import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../ui/tooltip'
import {
  RuntimePairingGeneratorForm,
  type RuntimePairingIntent
} from './RuntimePairingGeneratorForm'

function renderForm(intent: RuntimePairingIntent, selectedAddress: string): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <RuntimePairingGeneratorForm
        intent={intent}
        loopbackAddress="127.0.0.1"
        networkInterfaces={[{ name: 'tailscale0', address: '100.76.32.125' }]}
        selectedAddress={selectedAddress}
        refreshingNetworkInterfaces={false}
        isGeneratingPairing={false}
        webClientUrl={null}
        runtimePairingUrl={null}
        copiedTarget={null}
        generatedAddress={null}
        onIntentChange={vi.fn()}
        onSelectedAddressChange={vi.fn()}
        onRefreshNetworkInterfaces={vi.fn()}
        onGenerate={vi.fn()}
        onCopy={vi.fn()}
      />
    </TooltipProvider>
  )
}

describe('RuntimePairingGeneratorForm', () => {
  it('uses detected interfaces for another-device intent', () => {
    const markup = renderForm('another', '100.76.32.125')
    expect(markup).toContain('role="combobox"')
    expect(markup).not.toContain('id="runtime-pairing-custom-address"')
  })

  it('requires a dedicated value for custom-address intent', () => {
    const emptyMarkup = renderForm('custom', '')
    expect(emptyMarkup).toContain('id="runtime-pairing-custom-address"')
    expect(emptyMarkup).toContain('disabled=""')

    const populatedMarkup = renderForm('custom', 'openclaw.example.ts.net')
    expect(populatedMarkup).toContain('value="openclaw.example.ts.net"')
    expect(populatedMarkup).not.toContain('disabled=""')
  })
})
