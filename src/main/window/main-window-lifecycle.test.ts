import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { registerMainWindowClosedCleanup } from './main-window-lifecycle'

function createWindow(): EventEmitter & BrowserWindow {
  return new EventEmitter() as EventEmitter & BrowserWindow
}

describe('main-window lifecycle ownership', () => {
  it('keeps one closed listener for all registered owners and cleans it up', () => {
    const mainWindow = createWindow()
    const cleanups = Array.from({ length: 11 }, () => vi.fn())

    for (const cleanup of cleanups) {
      registerMainWindowClosedCleanup(mainWindow, cleanup)
    }

    expect(mainWindow.listenerCount('closed')).toBe(1)
    mainWindow.emit('closed')

    expect(mainWindow.listenerCount('closed')).toBe(0)
    for (const cleanup of cleanups) {
      expect(cleanup).toHaveBeenCalledOnce()
    }
  })

  it('removes an owner without affecting remaining cleanup callbacks', () => {
    const mainWindow = createWindow()
    const removed = vi.fn()
    const retained = vi.fn()

    const unregister = registerMainWindowClosedCleanup(mainWindow, removed)
    registerMainWindowClosedCleanup(mainWindow, retained)
    unregister()
    mainWindow.emit('closed')

    expect(removed).not.toHaveBeenCalled()
    expect(retained).toHaveBeenCalledOnce()
    expect(mainWindow.listenerCount('closed')).toBe(0)
  })

  it('reattaches one listener when a new owner arrives after the last owner leaves', () => {
    const mainWindow = createWindow()
    const first = registerMainWindowClosedCleanup(mainWindow, vi.fn())

    first()
    expect(mainWindow.listenerCount('closed')).toBe(0)

    registerMainWindowClosedCleanup(mainWindow, vi.fn())
    expect(mainWindow.listenerCount('closed')).toBe(1)
  })

  it('runs late and already-destroyed registrations immediately without a dead listener', () => {
    const closedWindow = createWindow()
    registerMainWindowClosedCleanup(closedWindow, vi.fn())
    closedWindow.emit('closed')
    const lateCleanup = vi.fn()

    registerMainWindowClosedCleanup(closedWindow, lateCleanup)

    expect(lateCleanup).toHaveBeenCalledOnce()
    expect(closedWindow.listenerCount('closed')).toBe(0)

    const destroyedWindow = createWindow() as EventEmitter & BrowserWindow
    destroyedWindow.isDestroyed = vi.fn(() => true)
    const destroyedCleanup = vi.fn()

    registerMainWindowClosedCleanup(destroyedWindow, destroyedCleanup)

    expect(destroyedCleanup).toHaveBeenCalledOnce()
    expect(destroyedWindow.listenerCount('closed')).toBe(0)
  })

  it('removes an existing listener when destruction is observed during late registration', () => {
    const mainWindow = createWindow() as EventEmitter & BrowserWindow
    const isDestroyed = vi.fn(() => false)
    mainWindow.isDestroyed = isDestroyed
    const existingCleanup = vi.fn()
    const lateCleanup = vi.fn()
    registerMainWindowClosedCleanup(mainWindow, existingCleanup)

    isDestroyed.mockReturnValue(true)
    registerMainWindowClosedCleanup(mainWindow, lateCleanup)

    expect(existingCleanup).toHaveBeenCalledOnce()
    expect(lateCleanup).toHaveBeenCalledOnce()
    expect(mainWindow.listenerCount('closed')).toBe(0)
  })

  it('runs reentrant registrations immediately and keeps the closed listener detached', () => {
    const mainWindow = createWindow()
    const reentrant = vi.fn()
    const first = vi.fn(() => registerMainWindowClosedCleanup(mainWindow, reentrant))
    registerMainWindowClosedCleanup(mainWindow, first)

    mainWindow.emit('closed')

    expect(first).toHaveBeenCalledOnce()
    expect(reentrant).toHaveBeenCalledOnce()
    expect(mainWindow.listenerCount('closed')).toBe(0)
  })

  it('runs every cleanup and surfaces all cleanup failures', () => {
    const mainWindow = createWindow()
    const firstFailure = new Error('first cleanup failed')
    const secondFailure = new Error('second cleanup failed')
    const retained = vi.fn()
    registerMainWindowClosedCleanup(mainWindow, () => {
      throw firstFailure
    })
    registerMainWindowClosedCleanup(mainWindow, retained)
    registerMainWindowClosedCleanup(mainWindow, () => {
      throw secondFailure
    })

    let thrown: unknown
    try {
      mainWindow.emit('closed')
    } catch (error) {
      thrown = error
    }

    expect(retained).toHaveBeenCalledOnce()
    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual([firstFailure, secondFailure])
    expect(mainWindow.listenerCount('closed')).toBe(0)
  })
})
