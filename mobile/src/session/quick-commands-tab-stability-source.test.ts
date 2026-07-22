import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)

function getQuickCommandsTabSource(): string {
  const start = source.indexOf('accessibilityLabel="New tab"')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('{/* Content-row host', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('quick-commands tab stability', () => {
  it('keeps the button mounted while preserving the capability gate', () => {
    const tabSource = getQuickCommandsTabSource()

    expect(tabSource).toContain('<QuickCommandsTabButton')
    expect(tabSource).not.toContain('{quickCommandsSupported === true ?')
    expect(tabSource).toContain('if (quickCommandsSupported === true)')
    expect(tabSource).toContain('setShowQuickCommands(true)')
    expect(tabSource).toContain('Desktop update required for quick commands')
    expect(tabSource).toContain('Checking desktop capabilities — try again in a moment')
  })

  it('only presents the sheet after support is confirmed', () => {
    expect(source).toContain('visible={showQuickCommands && quickCommandsSupported === true}')
  })
})
