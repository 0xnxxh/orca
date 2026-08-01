import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why a source-text test: the arm/disarm calls live in closures built inside
// openMainWindow(), and nothing can import src/main/index.ts (app-level side
// effects at module scope). Unit tests pin the module's behaviour; only this
// pins that index.ts still calls it, which a revert experiment showed no other
// test in src/main does.
describe('renderer recovery outcome wiring in index.ts', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

  function sliceBlock(startAnchor: string, endAnchor: string, from = 0): string {
    const start = source.indexOf(startAnchor, from)
    expect(start).toBeGreaterThanOrEqual(0)
    const end = source.indexOf(endAnchor, start)
    // Why: an unresolved end anchor slices to EOF and passes against unrelated code.
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('arms the outcome check on the auto-recovery reload', () => {
    const block = sliceBlock(
      'onBeforeRecoveryReload: (webContentsId) => {',
      "recordDurableCrashBreadcrumb('renderer_recovery_reload')"
    )

    expect(block).toContain('noteRendererRecoveryReloadIssued()')
  })

  it('disarms before prompting when the recovery breaker gives up', () => {
    const block = sliceBlock(
      'onRendererRecoveryExhausted: ({ details, recentRecoveryCount }) => {',
      'void presentRendererRecoveryPrompt(recentRecoveryCount)'
    )

    expect(block).toContain('clearRendererRecoveryReloadIssued()')
  })

  it('disarms on every user-initiated reload of the main window', () => {
    const reloadAnchor = 'onBeforeReload: ({ ignoreCache, webContentsId }) => {'
    // Why: createMainWindow's force-reload shortcut and the app menu wire this
    // separately, so a disarm on only one of them still mis-stamps the other.
    const firstStart = source.indexOf(reloadAnchor)
    const secondStart = source.indexOf(reloadAnchor, firstStart + reloadAnchor.length)
    expect(secondStart).toBeGreaterThan(firstStart)
    expect(source.indexOf(reloadAnchor, secondStart + reloadAnchor.length)).toBe(-1)

    for (const from of [firstStart, secondStart]) {
      const block = sliceBlock(
        reloadAnchor,
        "recordCrashBreadcrumb('manual_reload_requested', { ignoreCache })",
        from
      )
      // Why slice the guard rather than the whole block: the app menu reloads
      // whichever window has focus, so a disarm outside this check would let a
      // dashboard pop-out reload throw away the main renderer's pending arm.
      const guardStart = block.indexOf('if (mainWindow?.webContents.id === webContentsId) {')
      expect(guardStart).toBeGreaterThanOrEqual(0)
      const guard = block.slice(guardStart, block.lastIndexOf('}'))

      expect(guard).toContain('markExpectedRendererReload(webContentsId)')
      expect(guard).toContain('clearRendererRecoveryReloadIssued()')
    }
  })
})
