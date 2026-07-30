// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

function iifeSource(): string {
  const start = XTERM_HTML.indexOf('(function() {')
  const end = XTERM_HTML.lastIndexOf('})();')
  return XTERM_HTML.slice(start, end + '})();'.length)
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf('<body>') + '<body>'.length
  const end = XTERM_HTML.indexOf('<script>', start)
  return XTERM_HTML.slice(start, end)
}

type BufferState = {
  baseY: number
  type: 'alternate' | 'normal'
  viewportY: number
}

type TerminalStub = ReturnType<typeof makeTerminal>
type RegisteredWindowListener = {
  listener: EventListenerOrEventListenerObject
  options?: boolean | AddEventListenerOptions
  type: string
}

const ESC = '\u001b'
const DEFAULT_MOUSE_REPORT_RE = new RegExp(`${ESC}\\[M[\\s\\S]{3}`, 'g')

function makeTerminal(
  buffer: BufferState,
  select: (col: number, row: number, len: number) => void
) {
  const terminal = {
    cols: 40,
    rows: 24,
    options: { fontSize: 13 },
    modes: { mouseTrackingMode: 'none' as string },
    element: null as HTMLElement | null,
    _core: {
      _renderService: { dimensions: { css: { cell: { width: 8, height: 15 } } } }
    },
    buffer: {
      active: {
        get baseY() {
          return buffer.baseY
        },
        get type() {
          return buffer.type
        },
        get viewportY() {
          return buffer.viewportY
        },
        cursorY: 0,
        length: 1,
        getLine: () => null
      }
    },
    write(_data: string, callback?: () => void) {
      callback?.()
    },
    open(surface: HTMLElement) {
      terminal.element = surface
    },
    loadAddon() {},
    resize(cols: number, rows: number) {
      terminal.cols = cols
      terminal.rows = rows
    },
    clear() {},
    reset() {},
    refresh() {},
    selectAll() {},
    clearSelection() {},
    select,
    scrollLines() {},
    scrollToBottom() {},
    scrollToLine() {},
    attachCustomKeyEventHandler() {},
    getSelection: () => '',
    onData: () => ({ dispose() {} }),
    onLineFeed: () => ({ dispose() {} }),
    onScroll: () => ({ dispose() {} }),
    onWriteParsed: () => ({ dispose() {} }),
    dispose() {}
  }
  return terminal
}

function surfaceEl(): HTMLElement {
  const surface = document.getElementById('terminal-surface')
  if (!surface) {
    throw new Error('terminal surface missing')
  }
  return surface
}

function dispatchPointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: {
    pointerType?: string
    x?: number
    y?: number
    button?: number
    buttons?: number
  } = {}
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 40,
    clientY: init.y ?? 60,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0
  })
  // Why: happy-dom's PointerEvent init drops pointerType; grafting it onto a
  // MouseEvent exercises the same duck-typed reads the WebView handler does.
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' })
  surfaceEl().dispatchEvent(event)
}

function mouseClick(x: number, y: number): void {
  dispatchPointer('pointerdown', { x, y, button: 0, buttons: 1 })
  dispatchPointer('pointerup', { x, y, button: 0, buttons: 0 })
}

function mouseDrag(x1: number, y1: number, x2: number, y2: number): void {
  dispatchPointer('pointerdown', { x: x1, y: y1, button: 0, buttons: 1 })
  const midX = Math.round((x1 + x2) / 2)
  const midY = Math.round((y1 + y2) / 2)
  dispatchPointer('pointermove', { x: midX, y: midY, button: 0, buttons: 1 })
  dispatchPointer('pointermove', { x: x2, y: y2, button: 0, buttons: 1 })
  dispatchPointer('pointerup', { x: x2, y: y2, button: 0, buttons: 0 })
}

function postedMessages(postMessage: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)) as Record<string, unknown>)
}

function terminalInputBytes(postMessage: ReturnType<typeof vi.fn>): string {
  return postedMessages(postMessage)
    .filter((msg) => msg.type === 'terminal-input')
    .map((msg) => (msg.bytes as string) ?? '')
    .join('')
}

describe('terminal WebView external mouse click and drag', () => {
  let animationFrames: Array<() => void>
  let buffer: BufferState
  let postMessage: ReturnType<typeof vi.fn>
  let registeredWindowListeners: RegisteredWindowListener[]
  let select: ReturnType<typeof vi.fn>
  let terminals: TerminalStub[]

  function boot(): void {
    document.body.innerHTML = bodyMarkup()
    new Function(iifeSource())()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'init', cols: 40, rows: 24, initialData: '' })
      })
    )
    // Why: init commits the replacement surface on the next animation frame.
    while (animationFrames.length > 0) {
      animationFrames.shift()?.()
    }
  }

  function activeTerminal(): TerminalStub {
    const terminal = terminals[terminals.length - 1]
    if (!terminal) {
      throw new Error('terminal missing')
    }
    return terminal
  }

  beforeEach(() => {
    animationFrames = []
    buffer = { baseY: 0, type: 'normal', viewportY: 0 }
    registeredWindowListeners = []
    select = vi.fn()
    terminals = []
    const addWindowEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      registeredWindowListeners.push({ type, listener, options })
      addWindowEventListener(type, listener, options)
    }) as typeof window.addEventListener)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Object.defineProperty(window, 'innerWidth', { value: 381, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 612, configurable: true })
    postMessage = vi.fn()
    const webWindow = window as unknown as {
      Terminal: new () => TerminalStub
      ReactNativeWebView: { postMessage: (data: string) => void }
    }
    webWindow.Terminal = function () {
      const terminal = makeTerminal(buffer, select)
      terminals.push(terminal)
      return terminal
    } as unknown as new () => TerminalStub
    webWindow.ReactNativeWebView = { postMessage }
  })

  afterEach(() => {
    for (const { type, listener, options } of registeredWindowListeners) {
      window.removeEventListener(type, listener as EventListener, options)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports a mouse click to a click-tracking TUI the way a touch tap does (#8818)', () => {
    boot()
    activeTerminal().modes.mouseTrackingMode = 'vt200'

    mouseClick(40, 60)

    // Default (non-SGR) encoding: press (32=' ') then release (35='#'), each
    // ESC [ M btn col row. Cell bytes depend on the fit scale, not on routing.
    const bytes = terminalInputBytes(postMessage)
    expect(bytes).toHaveLength(12)
    expect(bytes.slice(0, 4)).toBe(`${ESC}[M `)
    expect(bytes.slice(6, 10)).toBe(`${ESC}[M#`)
    expect(bytes.slice(4, 6)).toBe(bytes.slice(10, 12))
  })

  it('sends press, per-cell motion, and release for a drag-tracking mouse drag', () => {
    boot()
    activeTerminal().modes.mouseTrackingMode = 'drag'

    mouseDrag(40, 60, 160, 60)

    const bytes = terminalInputBytes(postMessage)
    const reports = bytes.match(DEFAULT_MOUSE_REPORT_RE) ?? []
    expect(reports.length).toBeGreaterThanOrEqual(3)
    expect(reports[0]?.charCodeAt(3)).toBe(32)
    for (const motion of reports.slice(1, -1)) {
      expect(motion.charCodeAt(3)).toBe(64)
    }
    expect(reports[reports.length - 1]?.charCodeAt(3)).toBe(35)
    // Motion reports are deduped per cell, so a horizontal drag advances columns.
    const motionCols = reports.slice(1, -1).map((report) => report.charCodeAt(4))
    expect(new Set(motionCols).size).toBe(motionCols.length)
  })

  it('does not report press or motion for an x10 click-only TUI drag', () => {
    boot()
    activeTerminal().modes.mouseTrackingMode = 'x10'

    mouseDrag(40, 60, 160, 60)

    // x10 reports presses only; the press goes out at drag start, no motion or
    // release must follow.
    const bytes = terminalInputBytes(postMessage)
    expect(bytes.slice(0, 4)).toBe(`${ESC}[M `)
    expect(bytes).toHaveLength(6)
  })

  it('selects character-anchored text on a mouse drag outside tracking mode', () => {
    boot()
    // Why: init itself emits a set-select-mode reset; only the drag matters here.
    postMessage.mockClear()

    mouseDrag(40, 60, 160, 90)

    expect(terminalInputBytes(postMessage)).toBe('')
    expect(select).toHaveBeenCalled()
    expect(document.getElementById('selection-overlay')?.classList.contains('active')).toBe(true)
    const modes = postedMessages(postMessage).filter((msg) => msg.type === 'set-select-mode')
    expect(modes).toEqual([{ type: 'set-select-mode', enabled: true }])
  })

  it('dismisses an existing selection with a click without focusing the keyboard', () => {
    boot()
    mouseDrag(40, 60, 160, 90)
    postMessage.mockClear()

    mouseClick(240, 200)

    const messages = postedMessages(postMessage)
    expect(messages.filter((msg) => msg.type === 'set-select-mode')).toEqual([
      { type: 'set-select-mode', enabled: false }
    ])
    expect(messages.filter((msg) => msg.type === 'terminal-tap')).toEqual([])
    expect(document.getElementById('selection-overlay')?.classList.contains('active')).toBe(false)
  })

  it('routes a plain mouse click to the tap pipeline for keyboard focus', () => {
    boot()

    mouseClick(40, 60)

    const messages = postedMessages(postMessage)
    expect(messages.filter((msg) => msg.type === 'terminal-tap')).toHaveLength(1)
    expect(terminalInputBytes(postMessage)).toBe('')
  })

  it('ignores non-mouse pointers and non-left buttons', () => {
    boot()
    activeTerminal().modes.mouseTrackingMode = 'vt200'

    dispatchPointer('pointerdown', { pointerType: 'touch', x: 40, y: 60, button: 0, buttons: 1 })
    dispatchPointer('pointerup', { pointerType: 'touch', x: 40, y: 60, button: 0, buttons: 0 })
    dispatchPointer('pointerdown', { x: 40, y: 60, button: 2, buttons: 2 })
    dispatchPointer('pointerup', { x: 40, y: 60, button: 2, buttons: 0 })

    expect(terminalInputBytes(postMessage)).toBe('')
    expect(postedMessages(postMessage).filter((msg) => msg.type === 'terminal-tap')).toEqual([])
  })

  it('lets the touch dispatcher own a gesture when touch events follow pointerdown', () => {
    boot()
    activeTerminal().modes.mouseTrackingMode = 'vt200'

    dispatchPointer('pointerdown', { x: 40, y: 60, button: 0, buttons: 1 })
    const touchStart = new Event('touchstart', { bubbles: true })
    // Why: the document tap dispatcher reads touches[0]; happy-dom's plain
    // Event lacks it.
    Object.defineProperty(touchStart, 'touches', {
      value: [{ identifier: 7, clientX: 40, clientY: 60 }]
    })
    surfaceEl().dispatchEvent(touchStart)
    dispatchPointer('pointerup', { x: 40, y: 60, button: 0, buttons: 0 })

    // Why: Android SOURCE_MOUSE injections can pair a mouse pointerdown with
    // real touch events; double-handling would double the click report.
    expect(terminalInputBytes(postMessage)).toBe('')
  })

  it('releases a tracked drag when the pointer is cancelled mid-gesture', () => {
    boot()
    activeTerminal().modes.mouseTrackingMode = 'drag'

    dispatchPointer('pointerdown', { x: 40, y: 60, button: 0, buttons: 1 })
    dispatchPointer('pointermove', { x: 160, y: 60, button: 0, buttons: 1 })
    dispatchPointer('pointercancel', { x: 160, y: 60 })

    const bytes = terminalInputBytes(postMessage)
    const reports = bytes.match(DEFAULT_MOUSE_REPORT_RE) ?? []
    // Press went to the TUI, so the cancel must not leave the button latched.
    expect(reports[reports.length - 1]?.charCodeAt(3)).toBe(35)
  })
})
