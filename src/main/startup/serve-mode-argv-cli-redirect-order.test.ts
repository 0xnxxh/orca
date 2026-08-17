import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCliLaunchArgs } from './cli-launch-redirect'
import { argvRequestsServeMode, normalizeServeModeArgv } from './serve-mode-argv'

// Why: index.ts must run the CLI redirect before rewriting argv. Rewriting
// first replaces the `serve` positional with `--serve`, so the redirect's
// command-name lookup finds a port number instead of a command and bails —
// silently dropping direct serve launches out of the CLI path (#12677).

const CLI_ENTRY_PATH = '/opt/orca/resources/app.asar.unpacked/out/cli/index.js'
const REDIRECT_OPTIONS = {
  platform: 'linux' as const,
  isPackaged: true,
  commandNames: ['serve', 'status']
}

function rewriteAsIndexDoes(argv: string[]): string[] {
  return argvRequestsServeMode(argv) ? normalizeServeModeArgv(argv) : argv
}

describe('serve argv rewrite vs CLI launch redirect ordering', () => {
  const launchArgv = ['/opt/orca/orca-ide', '--no-sandbox', 'serve', '--port', '7777', '--json']

  it('hands the launch argv to the CLI when the redirect runs first', () => {
    expect(getCliLaunchArgs(launchArgv, CLI_ENTRY_PATH, REDIRECT_OPTIONS)).toEqual([
      'serve',
      '--port',
      '7777',
      '--json'
    ])
  })

  it('loses the redirect if the rewrite runs first', () => {
    const rewritten = rewriteAsIndexDoes(launchArgv)
    expect(rewritten).toContain('--serve')
    expect(getCliLaunchArgs(rewritten, CLI_ENTRY_PATH, REDIRECT_OPTIONS)).toBeNull()
  })

  it('leaves non-serve CLI commands redirectable either way', () => {
    const argv = ['/opt/orca/orca-ide', 'status']
    expect(rewriteAsIndexDoes(argv)).toEqual(argv)
    expect(getCliLaunchArgs(argv, CLI_ENTRY_PATH, REDIRECT_OPTIONS)).toEqual(['status'])
  })

  // Why source text: the ordering only exists as statement order at index.ts module scope, and the
  // cases above stay green if it is reversed — nothing else would catch the regression.
  it('keeps index.ts running the CLI redirect before the argv rewrite', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const redirect = source.indexOf('maybeRedirectCliLaunch({')
    const rewrite = source.indexOf('process.argv = normalizeServeModeArgv(process.argv)')
    const serveModeCheck = source.indexOf("const isServeMode = process.argv.includes('--serve')")

    expect(redirect).toBeGreaterThanOrEqual(0)
    expect(rewrite).toBeGreaterThan(redirect)
    // The rewrite is pointless unless it lands before the flag it exists to inject is read.
    expect(serveModeCheck).toBeGreaterThan(rewrite)
  })
})
