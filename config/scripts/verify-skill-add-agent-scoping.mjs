import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Proves the resolved skills CLI still honours our --agent scoping (#11593).
// The vendor's parser silently drops flags it does not recognize, and its
// zero-detected non-interactive branch installs into every agent it knows
// (~75), so a renamed --agent would revive that fan-out with exit 0. Run 1
// asserts our exact argv shape stays scoped; run 2 replays the rename (our
// flag unknown, its value demoted to an ignored positional) and asserts the
// fan-out still exists — if run 2 ever stops fanning out, the failure shape
// this contract discriminates on has changed and needs a human re-read.

function option(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

const cliOption = option('cli') ?? 'pinned'
const pinSource = await readFile('src/shared/skills-cli-version.ts', 'utf8')
const pinnedVersion = /SKILLS_CLI_VERSION = '([^']+)'/.exec(pinSource)?.[1]
if (!pinnedVersion) {
  throw new Error('Could not read SKILLS_CLI_VERSION from src/shared/skills-cli-version.ts')
}
// Why: defaulting to the pin means a version-bump PR re-proves the contract
// against the new version with no workflow edit; `latest` is the drift canary.
const cliVersion = cliOption === 'pinned' ? pinnedVersion : cliOption

const FANOUT_MIN = 20
const isWindows = process.platform === 'win32'
const sandbox = await mkdtemp(path.join(tmpdir(), 'orca-skill-add-agent-scoping-'))
const fixture = path.join(sandbox, 'fixture')
const probeName = 'scoping-probe'

// Why: an explicit allowlist, never process.env — inherited agent homes
// (CODEX_HOME), in-agent markers, or agent CLIs on PATH would make the CLI's
// detection non-zero and mask the zero-detected branch this contract pins.
const nodeBinDir = path.dirname(process.execPath)
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
const scrubbedPath = isWindows
  ? [nodeBinDir, path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter)
  : [nodeBinDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter)

function sandboxEnv(home) {
  return {
    PATH: scrubbedPath,
    HOME: home,
    USERPROFILE: home,
    XDG_STATE_HOME: path.join(sandbox, 'state'),
    npm_config_cache: path.join(sandbox, 'npm-cache'),
    TMPDIR: path.join(sandbox, 'tmp'),
    TEMP: path.join(sandbox, 'tmp'),
    TMP: path.join(sandbox, 'tmp'),
    DO_NOT_TRACK: '1',
    CI: '1',
    ...(isWindows
      ? {
          APPDATA: path.join(home, 'AppData', 'Roaming'),
          LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
          SystemRoot: systemRoot,
          windir: process.env.windir ?? systemRoot,
          ComSpec: process.env.ComSpec ?? path.join(systemRoot, 'System32', 'cmd.exe'),
          PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
        }
      : {})
  }
}

function execSkills(home, args) {
  const executable = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npx'
  const cliArgs = ['--yes', `skills@${cliVersion}`, ...args]
  execFileSync(executable, isWindows ? ['/d', '/s', '/c', 'npx.cmd', ...cliArgs] : cliArgs, {
    // Why: the sandbox cwd keeps the repo's own .npmrc out of the child npm.
    cwd: sandbox,
    env: sandboxEnv(home),
    stdio: 'inherit'
  })
}

// npm/npx working directories the child may create in a bare home; everything
// else a run leaves behind is an agent placement.
const NON_AGENT_ENTRIES = new Set(['.npm', '.cache', '.config', '.local', 'AppData'])

async function agentEntries(home) {
  const entries = await readdir(home).catch(() => [])
  return entries.filter((entry) => !NON_AGENT_ENTRIES.has(entry)).sort()
}

try {
  await mkdir(path.join(fixture, 'skills', probeName), { recursive: true })
  await writeFile(
    path.join(fixture, 'skills', probeName, 'SKILL.md'),
    `---\nname: ${probeName}\ndescription: Contract probe for --agent scoping.\n---\n\n# Scoping probe\n`
  )
  await mkdir(path.join(sandbox, 'tmp'), { recursive: true })

  // Run 1 — the exact argv shape Orca spawns, minus the repo source: --agent
  // must both skip detection and confine placements to its target.
  const homeScoped = path.join(sandbox, 'home-scoped')
  await mkdir(homeScoped, { recursive: true })
  execSkills(homeScoped, [
    'add',
    fixture,
    '--skill',
    probeName,
    '--global',
    '--agent',
    'claude-code',
    '-y'
  ])
  const scoped = await agentEntries(homeScoped)
  await stat(path.join(homeScoped, '.claude', 'skills', probeName))
  // The CLI may also write the canonical universal placement; anything else is
  // the fan-out this contract exists to catch.
  const leaked = scoped.filter((entry) => entry !== '.claude' && entry !== '.agents')
  if (!scoped.includes('.claude') || leaked.length > 0) {
    throw new Error(
      `skills@${cliVersion} no longer honours --agent claude-code: placements [${scoped.join(', ')}]`
    )
  }
  console.log(`[skill-add-agent-scoping] scoped install placed only: ${scoped.join(', ')}`)

  // Run 2 — the upstream-rename replay: an unknown flag whose value degrades
  // to an ignored positional. Today that means the all-agents fan-out.
  const homeDrift = path.join(sandbox, 'home-drift')
  await mkdir(homeDrift, { recursive: true })
  execSkills(homeDrift, [
    'add',
    fixture,
    '--skill',
    probeName,
    '--global',
    '--orca-scoping-contract-probe',
    'claude-code',
    '-y'
  ])
  const drifted = await agentEntries(homeDrift)
  if (drifted.length < FANOUT_MIN) {
    throw new Error(
      `The rename replay produced ${drifted.length} agent placements (expected >= ${FANOUT_MIN}). ` +
        `skills@${cliVersion} changed the unscoped non-interactive branch; re-read its target ` +
        'resolution before trusting this contract.'
    )
  }
  console.log(
    `[skill-add-agent-scoping] rename replay fanned out to ${drifted.length} agent placements`
  )
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
