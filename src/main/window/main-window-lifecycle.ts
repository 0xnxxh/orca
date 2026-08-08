import type { BrowserWindow } from 'electron'

type MainWindowLifecycle = {
  closed: boolean
  listening: boolean
  cleanups: Set<() => void>
  onClosed: () => void
}

const lifecycleByWindow = new WeakMap<BrowserWindow, MainWindowLifecycle>()

function removeClosedListener(mainWindow: BrowserWindow, onClosed: () => void): void {
  mainWindow.removeListener?.('closed', onClosed)
}

function isDestroyed(mainWindow: BrowserWindow): boolean {
  return typeof mainWindow.isDestroyed === 'function' && mainWindow.isDestroyed()
}

function surfaceCleanupFailures(failures: unknown[]): void {
  if (failures.length === 0) {
    return
  }
  if (failures.length === 1) {
    throw failures[0]
  }
  throw new AggregateError(failures, 'main window closed cleanup failed')
}

function closeMainWindowLifecycle(
  mainWindow: BrowserWindow,
  lifecycle: MainWindowLifecycle
): unknown[] {
  if (lifecycle.closed) {
    return []
  }
  lifecycle.closed = true
  lifecycle.listening = false
  removeClosedListener(mainWindow, lifecycle.onClosed)
  const cleanups = [...lifecycle.cleanups]
  lifecycle.cleanups.clear()
  const failures: unknown[] = []
  for (const registeredCleanup of cleanups) {
    try {
      registeredCleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

/** Registers main-window teardown under the single BrowserWindow `closed` owner. */
export function registerMainWindowClosedCleanup(
  mainWindow: BrowserWindow,
  cleanup: () => void
): () => void {
  let lifecycle = lifecycleByWindow.get(mainWindow)
  if (!lifecycle) {
    const onClosed = (): void => {
      surfaceCleanupFailures(closeMainWindowLifecycle(mainWindow, lifecycle!))
    }
    lifecycle = { closed: false, listening: false, cleanups: new Set(), onClosed }
    lifecycleByWindow.set(mainWindow, lifecycle)
  }

  if (lifecycle.closed || isDestroyed(mainWindow)) {
    const failures = closeMainWindowLifecycle(mainWindow, lifecycle)
    try {
      cleanup()
    } catch (error) {
      failures.push(error)
    }
    surfaceCleanupFailures(failures)
    return () => {}
  }

  lifecycle.cleanups.add(cleanup)
  if (!lifecycle.listening) {
    lifecycle.listening = true
    mainWindow.on('closed', lifecycle.onClosed)
  }
  return () => {
    const current = lifecycleByWindow.get(mainWindow)
    if (!current || current.closed) {
      return
    }
    current.cleanups.delete(cleanup)
    if (current.cleanups.size === 0) {
      removeClosedListener(mainWindow, current.onClosed)
      current.listening = false
    }
  }
}
