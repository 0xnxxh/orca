import { describe, expect, it } from 'vitest'
import { CLI_COMMAND_NAMES } from '../main/startup/cli-command-names'
import { COMMAND_SPECS } from './specs'

// Why this test lives under src/cli: the Electron-side CLI launch redirect has
// to know which first positionals are CLI commands, but the main tsconfig
// cannot import the CLI project — so the parity check has to run from this side.
//
// It fails when a new top-level command is added to COMMAND_SPECS without being
// listed for the redirect. That drift used to be silent and expensive: the
// launch fell through to Chromium startup, which core-dumps on a headless or
// unsandboxed Linux host, so `orca-ide skills get …` dumped core rather than
// printing anything (#14229). Ten commands had already drifted out.

const specCommandNames = [...new Set(COMMAND_SPECS.map((spec) => spec.path[0]))].sort()

describe('CLI command-name parity between COMMAND_SPECS and the launch redirect', () => {
  it('has commands to compare', () => {
    expect(specCommandNames.length).toBeGreaterThan(0)
  })

  it('redirects every top-level CLI command', () => {
    const redirected = new Set<string>(CLI_COMMAND_NAMES)
    expect(specCommandNames.filter((name) => !redirected.has(name))).toEqual([])
  })

  // Why: an entry with no spec would send a launch that is not a CLI command
  // into node mode, where it fails with an unknown-command error instead of
  // opening the desktop app.
  it('lists no command that COMMAND_SPECS does not define', () => {
    const specNames = new Set(specCommandNames)
    expect([...CLI_COMMAND_NAMES].filter((name) => !specNames.has(name))).toEqual([])
  })

  it('stays sorted and free of duplicates so additions are easy to review', () => {
    expect([...CLI_COMMAND_NAMES]).toEqual([...new Set(CLI_COMMAND_NAMES)].sort())
  })
})
