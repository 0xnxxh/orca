type MaybeClearableRenderService = {
  clear?: () => void
}

type TerminalWithRenderService = {
  _core?: {
    _renderService?: MaybeClearableRenderService
  }
}

/** Clears xterm's retained cell model so the next refresh redraws every cell. */
export function invalidateTerminalRenderModel(terminal: unknown): boolean {
  const service = (terminal as TerminalWithRenderService | null)?._core?._renderService
  if (!service || typeof service.clear !== 'function') {
    return false
  }
  try {
    service.clear()
    return true
  } catch {
    return false
  }
}
