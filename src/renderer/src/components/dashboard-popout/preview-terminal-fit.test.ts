// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreviewFitScheduler } from './preview-terminal-fit'

function dimension(element: HTMLElement, name: string, get: () => number): void {
  Object.defineProperty(element, name, { configurable: true, get })
}

describe('createPreviewFitScheduler', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('settles the reported adjacent-size cycle without another frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const box = document.createElement('div')
    const container = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    box.appendChild(container)
    container.appendChild(screen)
    const terminal = {
      cols: 84,
      rows: 24,
      options: { fontSize: 14 },
      buffer: { active: { cursorY: 0 } }
    }
    const measuredWidths = new Map([
      [14, 706],
      [6, 302],
      [6.5, 328]
    ])
    dimension(box, 'clientWidth', () => 315)
    dimension(box, 'clientHeight', () => 480)
    dimension(screen, 'offsetWidth', () => measuredWidths.get(terminal.options.fontSize)!)
    dimension(screen, 'offsetHeight', () => 384)
    const { scheduleFit } = createPreviewFitScheduler({
      container,
      getTerminal: () => terminal as never,
      getBaseFontSize: () => 14
    })

    scheduleFit()
    frames.shift()!(0)
    expect(terminal.options.fontSize).toBe(6)
    expect(frames).toHaveLength(1)

    frames.shift()!(0)
    expect(terminal.options.fontSize).toBe(6)
    expect(frames).toHaveLength(0)
  })

  it('allows the base font to return after a successful grid claim', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const box = document.createElement('div')
    const container = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    box.appendChild(container)
    container.appendChild(screen)
    const terminal = {
      cols: 200,
      rows: 24,
      options: { fontSize: 7 },
      buffer: { active: { cursorY: 0 } }
    }
    dimension(box, 'clientWidth', () => 800)
    dimension(box, 'clientHeight', () => 480)
    dimension(
      screen,
      'offsetWidth',
      () => (terminal.cols === 200 ? 800 : 400) * (terminal.options.fontSize / 7)
    )
    dimension(screen, 'offsetHeight', () => 192)
    const { scheduleFit } = createPreviewFitScheduler({
      container,
      getTerminal: () => terminal as never,
      getBaseFontSize: () => 14
    })

    scheduleFit()
    frames.shift()!(0)
    expect(terminal.options.fontSize).toBe(7)

    terminal.cols = 100
    scheduleFit()
    frames.shift()!(0)
    expect(terminal.options.fontSize).toBe(14)
    expect(frames).toHaveLength(1)

    frames.shift()!(0)
    expect(terminal.options.fontSize).toBe(14)
    expect(frames).toHaveLength(0)
  })
})
