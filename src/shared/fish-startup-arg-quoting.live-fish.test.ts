/**
 * Round-trips `quoteStartupArg(value, 'fish')` and `tokenizeStartupCommand(…, 'fish')`
 * through a REAL fish, because fish's quoting is only observable in fish.
 *
 * fish single quotes are not literal the way sh's are: `\\` and `\'` are escapes,
 * so sh's `'\''` idiom silently halves every backslash and a trailing backslash is
 * a hard syntax error. A string assertion against a hand-written expectation would
 * happily encode the same wrong rule, so the shell itself is the oracle.
 *
 * fish reads each case from a script file and echoes its argv back NUL-separated
 * (`string join0`), which is the only separator no test input can forge.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fishRequirementViolation, resolveFishBinary } from './fish-binary-requirement'
import { planHermesStartupQuery } from './hermes-startup-query'
import { buildAgentStartupPlan } from './tui-agent-startup'
import { quoteStartupArg, tokenizeStartupCommand } from './tui-agent-startup-shell'

const FISH = resolveFishBinary(4)
const itWithFish = FISH.available ? it : it.skip

let home: string | null = null

/**
 * Fully pinned: nothing ambient reaches fish, and LC_ALL wins over any LANG/LC_*
 * a host might contribute, so locale-sensitive parsing cannot vary by machine.
 */
const fishEnv = (root: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: root,
  XDG_CONFIG_HOME: root,
  XDG_DATA_HOME: path.join(root, 'data'),
  TERM: 'dumb',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8'
})

/** Runs `commandLine` in a config-free fish and returns the argv it produced. */
function fishArgv(commandLine: string): string[] {
  const root = home as string
  const scriptPath = path.join(root, 'probe.fish')
  const outPath = path.join(root, 'argv.bin')
  // Removed first so a run that dies before writing surfaces as ENOENT rather
  // than as the previous case's argv. `exit 0` only masks `string join`'s
  // nothing-to-join status 1; a syntax error still aborts the file with 127.
  rmSync(outPath, { force: true })
  writeFileSync(scriptPath, `string join0 -- ${commandLine} > ${outPath}\nexit 0\n`)
  execFileSync(FISH.path as string, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: fishEnv(root)
  })
  const raw = readFileSync(outPath, 'utf8')
  // join0 terminates the last element too, so the trailing empty split is not an argument.
  return raw.length === 0 ? [] : raw.split('\0').slice(0, -1)
}

const ADVERSARIAL_ARGS: readonly [name: string, value: string][] = [
  ['regex backslashes', 'use \\d+ or \\\\d and \\w'],
  ['UNC path', '\\\\server\\share\\dir'],
  ['windows drive path', 'C:\\Users\\nw\\Application Data'],
  ['apostrophes', "it's the user's own prompt"],
  ['trailing backslash', 'ends with a backslash\\'],
  ['lone backslash', '\\'],
  ['mixed quotes', `he said "hi" and 'bye'`],
  ['newlines', 'first line\nsecond line\n'],
  ['dollar expansions', '$PATH and ${HOME} and $(id -u)'],
  ['glob characters', '*.ts ?? [a-z] **/*.zzz'],
  ['command substitution parens', 'call (echo hi) and `echo hi`'],
  ['operators', 'a; b && c || d | e > f < g & h'],
  ['comment and tilde', '# not a comment ~ not a home'],
  ['tabs and unicode', 'tab\there 🐟 é'],
  ['escaped-quote soup', `a\\'b'c\\\\d"e`]
]

describe('quoteStartupArg round-trips through real fish', () => {
  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'orca-fish-quote-'))
  })

  afterAll(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true })
      home = null
    }
  })

  // Always runs, so the CI lane cannot report green with everything below skipped.
  it('has the fish this suite needs when CI requires one', () => {
    expect(fishRequirementViolation(FISH)).toBeNull()
  })

  for (const [name, value] of ADVERSARIAL_ARGS) {
    itWithFish(`survives ${name}`, () => {
      expect(fishArgv(quoteStartupArg(value, 'fish'))).toEqual([value])
    })
  }

  itWithFish('keeps multiple arguments separate', () => {
    const args = ADVERSARIAL_ARGS.map(([, value]) => value)
    expect(fishArgv(args.map((arg) => quoteStartupArg(arg, 'fish')).join(' '))).toEqual(args)
  })

  itWithFish('proves the sh quoting this replaced was broken in fish', () => {
    // Corrupted, not rejected: the backslashes silently halve.
    expect(fishArgv(quoteStartupArg('\\\\server\\share', 'posix'))).toEqual(['\\server\\share'])
    // And a trailing backslash is a hard syntax error that would kill the launch.
    expect(() => fishArgv(quoteStartupArg('ends with a backslash\\', 'posix'))).toThrow()
  })

  itWithFish('proves the sh tokenizer this replaced disagreed with fish', () => {
    const line = String.raw`claude --prompt 'match \d+ in \\server\share'`
    const posix = tokenizeStartupCommand(line, 'posix')
    expect(posix.ok).toBe(true)
    if (posix.ok) {
      expect(posix.tokens).not.toEqual(fishArgv(line))
    }
  })

  itWithFish('tokenizes a fish command line the way fish splits it', () => {
    const lines = [
      String.raw`claude --append-system-prompt 'match \d+ in \\server\share'`,
      String.raw`codex --cd "C:\Users\nw" --note 'it\'s mine'`,
      String.raw`hermes chat --query a\nb --flag "keep \n literal"`,
      String.raw`pi --path 'C:\\' --other "a\$b" --third x\ty`,
      String.raw`agent --hex \x41 --octal \101 --ctrl \cA`
    ]
    for (const line of lines) {
      const tokenized = tokenizeStartupCommand(line, 'fish')
      expect(tokenized.ok, line).toBe(true)
      if (!tokenized.ok) {
        continue
      }
      expect(tokenized.tokens, line).toEqual(fishArgv(line))
      // Re-quoting the parsed tokens must reproduce the same argv.
      expect(
        fishArgv(tokenized.tokens.map((token) => quoteStartupArg(token, 'fish')).join(' ')),
        line
      ).toEqual(tokenized.tokens)
    }
  })

  // The user-facing break: a composer prompt is quoted here and parsed by fish.
  itWithFish('delivers a composer prompt to the agent argv intact', () => {
    const root = home as string
    const capturePath = path.join(root, 'claude-argv.json')
    const claudePath = path.join(root, 'claude')
    const prompt = [
      String.raw`Use \d+ for digits and read \\server\share\notes.`,
      String.raw`Keep 'single' and "double" quotes, $PATH, *.ts and a ; too.`,
      'This last line ends in a backslash\\'
    ].join('\n')
    copyFileSync(process.execPath, claudePath)
    chmodSync(claudePath, 0o755)
    writeFileSync(
      path.join(root, 'capture.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)))`
    )
    rmSync(capturePath, { force: true })

    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt,
      cmdOverrides: { claude: `${quoteStartupArg(claudePath, 'fish')} capture.js` },
      platform: 'darwin',
      shell: 'fish'
    })
    expect(plan).not.toBeNull()

    const scriptPath = path.join(root, 'launch.fish')
    writeFileSync(scriptPath, `${plan?.launchCommand}\n`)
    execFileSync(FISH.path as string, [scriptPath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: fishEnv(root)
    })

    expect(JSON.parse(readFileSync(capturePath, 'utf8'))).toEqual([prompt])
  })

  // The `sh -c` wrapper's OUTER quoting is parsed by fish, and its payload is a
  // solid run of `\0NNN` octal escapes — the single worst case for the sh spelling.
  itWithFish('delivers a hermes startup query through the fish-quoted sh wrapper', () => {
    const root = home as string
    const capturePath = path.join(root, 'hermes-argv.json')
    const hermesPath = path.join(root, 'hermes')
    const prompt = [
      String.raw`Match \d+ inside \\server\share and keep 'quotes' plus "doubles".`,
      'A blank $PATH stays literal, as does *.ts.',
      'And this line ends with a backslash\\'
    ].join('\n')
    // A copy of node named `hermes` runs the `chat` script and records its argv.
    copyFileSync(process.execPath, hermesPath)
    chmodSync(hermesPath, 0o755)
    writeFileSync(
      path.join(root, 'chat'),
      `require('node:fs').writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)))`
    )
    rmSync(capturePath, { force: true })

    const plan = planHermesStartupQuery({
      baseCommand: quoteStartupArg(hermesPath, 'fish'),
      agentArgs: '--yolo',
      prompt,
      platform: 'darwin',
      shell: 'fish'
    })
    expect(plan).not.toBeNull()

    const scriptPath = path.join(root, 'hermes.fish')
    writeFileSync(scriptPath, `${plan?.command}\n`)
    execFileSync(FISH.path as string, [scriptPath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...fishEnv(root), ...plan?.env }
    })

    expect(JSON.parse(readFileSync(capturePath, 'utf8'))).toContain(`--query=${prompt}`)
  })
})
