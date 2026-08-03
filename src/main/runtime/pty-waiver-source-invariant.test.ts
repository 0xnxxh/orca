import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why (#11960): behavioural tests only reach one of the five removal branches in
// each file, so re-deriving the waiver from `force` at any of the other nine sites
// stays green while silently disabling the PTY gate on that path. `force` is set by
// the ordinary delete confirmation (to skip the dirty-file prompt) and is NOT user
// intent to delete past live terminals — so pin the wiring itself, at every site.
const FILES = [join(__dirname, '..', 'ipc', 'worktrees.ts'), join(__dirname, 'orca-runtime.ts')]

// Five removal branches per file, each passing the waiver through, plus the one
// conditional spread inside that file's stopPtysForDestructiveWorktreeRemoval.
const EXPECTED_SITES = 6

describe('the PTY-stop waiver is never derived from `force`', () => {
  it.each(FILES)('%s passes only an explicit waiver to the teardown', (file) => {
    const source = readFileSync(file, 'utf8')

    const values = [...source.matchAll(/allowUnverifiedStop:\s*([^,\n}]+)/g)].map((match) =>
      match[1].trim()
    )
    // Exact, not "at least": deleting a site would otherwise pass silently, leaving
    // that path's gate permanently strict — the original wedge on that branch.
    expect(values).toHaveLength(EXPECTED_SITES)
    for (const value of values) {
      expect(value).not.toMatch(/\bforce\b/)
    }
    // The five removal branches must forward the caller's waiver verbatim; only the
    // helper's own conditional spread may hardcode `true`, and it is guarded below.
    expect(values.filter((value) => value === 'args.allowUnverifiedPtyStop').length).toBe(
      file.endsWith('worktrees.ts') ? EXPECTED_SITES - 1 : 0
    )
    expect(values.filter((value) => value === 'true')).toHaveLength(1)

    // Why: checking the value alone is not enough — `...(force || allowUnverifiedStop
    // ? { allowUnverifiedStop: true } : {})` re-disables the gate on every confirmed
    // delete while the value stays a blameless `true`. Pin the guarding condition too.
    // `[\s\S]*?` rather than `[^?]*` so an optional chain (`args?.force`) inside the
    // condition cannot end the match early and slip the whole check.
    const conditions = [
      ...source.matchAll(/\.\.\.\(([\s\S]{0,200}?)\?\s*\{\s*allowUnverifiedStop:/g)
    ].map((match) => match[1].trim())
    expect(conditions).toHaveLength(1)
    for (const condition of conditions) {
      expect(condition).not.toMatch(/\bforce\b/)
    }
  })
})
