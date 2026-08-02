// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutRecorderButton } from './ShortcutRecorderButton'
import { TooltipProvider } from '../ui/tooltip'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

// Recording is the one surface whose whole job is to capture whatever key arrives, which makes it
// the easiest place to forget that an IME-owned keystroke carries no chord: its `key` is 'Process'
// or 'Unidentified', so capturing one writes a binding that can never fire.
describe('ShortcutRecorderButton while an IME owns the keystroke', () => {
  function renderRecording(): { button: HTMLElement; onCapture: ReturnType<typeof vi.fn> } {
    const onCapture = vi.fn()
    const view = render(
      <TooltipProvider>
        <ShortcutRecorderButton
          actionId="tab.closeAll"
          title="Close all tabs"
          platform="darwin"
          isDigitIndex={false}
          binding={null}
          bindingIndex={0}
          bindingCount={1}
          recording
          onStartRecording={vi.fn()}
          onCancelRecording={vi.fn()}
          onCapture={onCapture}
          onClearError={vi.fn()}
        />
      </TooltipProvider>
    )
    return { button: view.getByRole('button'), onCapture }
  }

  // The real shape a composing chord has. `key: 'Process'` would also be refused, but a Process
  // chord resolves to nothing anyway, so a test built on it passes with the guard deleted.
  const marked = { isComposing: true, keyCode: 229 }
  const shiftTap = { key: 'Shift', code: 'ShiftLeft', shiftKey: true }

  it('captures an ordinary chord', () => {
    const { button, onCapture } = renderRecording()

    fireEvent.keyDown(button, { key: 'w', code: 'KeyW', metaKey: true, shiftKey: true })

    expect(onCapture).toHaveBeenCalledWith(
      'tab.closeAll',
      expect.objectContaining({ key: 'w', code: 'KeyW', meta: true, shift: true })
    )
  })

  it('does not capture a marked chord', () => {
    const { button, onCapture } = renderRecording()

    fireEvent.keyDown(button, { key: 'w', code: 'KeyW', metaKey: true, ...marked })

    expect(onCapture).not.toHaveBeenCalled()
  })

  it('does not complete a double-tap whose second press is marked', () => {
    const { button, onCapture } = renderRecording()

    fireEvent.keyDown(button, shiftTap)
    fireEvent.keyUp(button, shiftTap)
    fireEvent.keyDown(button, { ...shiftTap, ...marked })

    expect(onCapture).not.toHaveBeenCalled()
  })

  it('does not let a marked release arm the second half of the gesture', () => {
    const { button, onCapture } = renderRecording()

    fireEvent.keyDown(button, shiftTap)
    fireEvent.keyUp(button, { ...shiftTap, ...marked })
    fireEvent.keyDown(button, shiftTap)

    expect(onCapture).not.toHaveBeenCalled()
  })

  it('still records a real double-tap', () => {
    const { button, onCapture } = renderRecording()

    fireEvent.keyDown(button, shiftTap)
    fireEvent.keyUp(button, shiftTap)
    fireEvent.keyDown(button, shiftTap)

    expect(onCapture).toHaveBeenCalledWith('tab.closeAll', { doubleTapModifier: 'Shift' })
  })
})
