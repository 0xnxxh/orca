import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('preload restart wiring', () => {
  const source = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf8')

  it('relays prevented unload and async updater failure IPC into renderer lifecycle events', () => {
    expect(source).toContain("ipcRenderer.on('updater:status'")
    expect(source).toContain('updaterQuitAbortRelay.handleStatus(status)')
    expect(source).toContain("ipcRenderer.on('window:unload-prevented'")
    expect(source).toContain(
      'window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))'
    )
  })

  it('marks updater preparation before invoking main and aborts it on immediate IPC failure', () => {
    const start = source.indexOf('quitAndInstall: async (): Promise<void> => {')
    const end = source.indexOf('onStatus: (callback) => {', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const block = source.slice(start, end)
    const prepare = block.indexOf('await prepareRendererForAppRestart(window, {')
    const markPrepared = block.indexOf('updaterQuitAbortRelay.markPrepared()')
    const invoke = block.indexOf("ipcRenderer.invoke('updater:quitAndInstall')")
    const abort = block.indexOf('updaterQuitAbortRelay.abort()')

    expect(prepare).toBeGreaterThanOrEqual(0)
    expect(markPrepared).toBeGreaterThan(prepare)
    expect(invoke).toBeGreaterThan(markPrepared)
    expect(abort).toBeGreaterThan(invoke)
    expect(block).toMatch(
      /try \{\s*return await ipcRenderer\.invoke\('updater:quitAndInstall'\)\s*\} catch \(error\) \{\s*updaterQuitAbortRelay\.abort\(\)\s*throw error\s*\}/
    )
  })
})
