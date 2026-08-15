import type { ManagedPaneInternal } from './pane-manager-types'

const observers = new WeakMap<ManagedPaneInternal, MutationObserver>()
const CSS_RGB_RE =
  /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/

export function squareCssColorAlpha(color: string): string {
  const match = CSS_RGB_RE.exec(color)
  if (!match) {
    return color
  }
  const [, red, green, blue, alphaText] = match
  const alpha = alphaText === undefined ? 1 : Number(alphaText)
  return `rgba(${red}, ${green}, ${blue}, ${alpha * alpha})`
}

export function observePaneTerminalBackground(pane: ManagedPaneInternal): void {
  disposePaneTerminalBackgroundObserver(pane)
  const terminalElement = pane.terminal.element
  if (!terminalElement) {
    return
  }

  let previous = ''
  const sync = () => {
    const background = terminalElement.style.backgroundColor
    if (!background || background === previous) {
      return
    }
    previous = background
    pane.xtermContainer.style.setProperty('--orca-terminal-live-background', background)
    pane.xtermContainer.style.setProperty(
      '--orca-terminal-webgl-background',
      squareCssColorAlpha(background)
    )
  }
  const observer = new MutationObserver(sync)
  observer.observe(terminalElement, { attributes: true, attributeFilter: ['style'] })
  observers.set(pane, observer)
  sync()
}

export function disposePaneTerminalBackgroundObserver(pane: ManagedPaneInternal): void {
  observers.get(pane)?.disconnect()
  observers.delete(pane)
}
