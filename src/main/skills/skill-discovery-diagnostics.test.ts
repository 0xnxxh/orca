import { describe, expect, it } from 'vitest'
import { formatSkillDiscoveryDiagnostics } from './skill-discovery-diagnostics'

describe('formatSkillDiscoveryDiagnostics', () => {
  it('proves which roots were walked and how much they returned', () => {
    expect(
      formatSkillDiscoveryDiagnostics({
        target: 'native-host',
        scannedRootIds: ['home-claude', 'home-agents'],
        rootCount: 15,
        presentRootCount: 3,
        cachedRootCount: 13,
        skillCount: 12,
        durationMs: 41
      })
    ).toBe(
      '[skills] scan target=native-host roots=15 present=3 cached=13 skills=12 ms=41 ' +
        'walked=home-claude,home-agents'
    )
  })

  it('never carries a filesystem path, only stable root ids', () => {
    const line = formatSkillDiscoveryDiagnostics({
      target: 'native-host',
      // Repo and plugin root ids are already hashed by `stablePathId`.
      scannedRootIds: ['repo-agents-4f1b2c3d4e5f6071', 'claude-plugin-9a8b7c6d5e4f3021'],
      rootCount: 2,
      presentRootCount: 2,
      cachedRootCount: 0,
      skillCount: 4,
      durationMs: 9
    })

    expect(line).not.toContain('/')
    expect(line).not.toContain('\\')
  })

  it('caps the root list so one line cannot grow with the repo count', () => {
    const line = formatSkillDiscoveryDiagnostics({
      target: 'native-host',
      scannedRootIds: Array.from({ length: 40 }, (_, index) => `root-${index}`),
      rootCount: 40,
      presentRootCount: 40,
      cachedRootCount: 0,
      skillCount: 40,
      durationMs: 120
    })

    expect(line).toContain('root-11')
    expect(line).not.toContain('root-12,')
    expect(line).toContain('+28 more')
  })

  it('omits the root list entirely when nothing was walked', () => {
    expect(
      formatSkillDiscoveryDiagnostics({
        target: 'wsl',
        scannedRootIds: [],
        rootCount: 12,
        presentRootCount: 0,
        cachedRootCount: 12,
        skillCount: 0,
        durationMs: 1
      })
    ).toBe('[skills] scan target=wsl roots=12 present=0 cached=12 skills=0 ms=1')
  })
})
