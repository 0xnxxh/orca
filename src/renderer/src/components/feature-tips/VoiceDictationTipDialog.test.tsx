// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_TIPS, type FeatureTip } from '../../../../shared/feature-tips'
import { VoiceDictationTipDialog } from './VoiceDictationTipDialog'

const shortcutMock = vi.hoisted(() => vi.fn(() => ({ keys: ['⌘', 'E'], doubleTap: false })))
const formatShortcutMock = vi.hoisted(() => vi.fn(() => [{ keys: ['⌘', 'E'], doubleTap: false }]))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyDetails: shortcutMock,
  formatShortcutKeyComboDetails: formatShortcutMock
}))

vi.mock('./VoiceDictationFeatureTipVisual', () => ({
  VoiceDictationFeatureTipVisual: () => <div data-testid="voice-visual" />
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>
}))

vi.mock('./FeatureTipActions', () => ({
  FeatureTipActions: () => <div data-testid="feature-tip-actions" />
}))

function getVoiceTip(): FeatureTip {
  const tip = FEATURE_TIPS.find((entry) => entry.id === 'voice-dictation')
  if (!tip) {
    throw new Error('Expected voice-dictation feature tip fixture')
  }
  return { ...tip }
}

function renderDialog(): string {
  return renderToStaticMarkup(
    <VoiceDictationTipDialog
      open
      tip={getVoiceTip()}
      primaryBusy={false}
      onOpenChange={vi.fn()}
      onPrimaryAction={vi.fn()}
      onSkip={vi.fn()}
      onVoiceSettingsClick={vi.fn()}
    />
  )
}

describe('VoiceDictationTipDialog', () => {
  beforeEach(() => {
    shortcutMock.mockReturnValue({ keys: ['⌘', 'E'], doubleTap: false })
    formatShortcutMock.mockReturnValue([{ keys: ['⌘', 'E'], doubleTap: false }])
  })

  it('uses the established feature-tip layout and durable copy', () => {
    const html = renderDialog()

    expect(html).toContain('TIP')
    expect(html).toContain('Dictate into any pane')
    expect(html).not.toContain('Turn speech into text wherever')
    expect(html).not.toContain('is here')
  })

  it('shows the live dictation shortcut and voice settings path', () => {
    const html = renderDialog()

    expect(html).toContain('⌘')
    expect(html).toContain('E')
    expect(html).toContain('to start voice dictation. Press')
    expect(html).toContain('again to stop.')
    expect(html).toContain('Settings → Voice')
  })

  it('falls back to the platform default shortcut when unassigned', () => {
    shortcutMock.mockReturnValue({ keys: [], doubleTap: false })
    formatShortcutMock.mockReturnValue([{ keys: ['Ctrl', 'E'], doubleTap: false }])

    const html = renderDialog()

    expect(formatShortcutMock).toHaveBeenCalledWith('voice.dictation')
    expect(html).toContain('Ctrl')
  })
})
