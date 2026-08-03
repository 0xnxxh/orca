import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why (#11960): behavioural tests only reach one of the five removal branches in
// each file, so re-deriving the waiver from `force` at any of the other nine sites
// stays green while silently disabling the PTY gate on that path. `force` is set by
// the ordinary delete confirmation (to skip the dirty-file prompt) and is NOT user
// intent to delete past live terminals — so pin the wiring itself, at every site.
const FILES = [join(__dirname, '..', 'ipc', 'worktrees.ts'), join(__dirname, 'orca-runtime.ts')]

describe('the PTY-stop waiver is never derived from `force`', () => {
  it.each(FILES)('%s passes only an explicit waiver to the teardown', (file) => {
    const source = readFileSync(file, 'utf8')
    const assignments = [...source.matchAll(/allowUnverifiedStop:\s*([^,\n}]+)/g)].map((match) =>
      match[1].trim()
    )

    // Each file wires five removal branches plus the one helper default.
    expect(assignments.length).toBeGreaterThanOrEqual(5)
    for (const assignment of assignments) {
      expect(assignment).not.toMatch(/\bforce\b/)
      expect(assignment).toMatch(/allowUnverifiedPtyStop|^true$/)
    }
  })
})
