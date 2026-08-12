#!/usr/bin/env node
/**
 * Regression proof: daemon replacement must not kill live coding-agent terminals.
 *
 * A daemon that is ALIVE and owns running agents, but too wedged to answer
 * `listSessions`, used to be indistinguishable from a dead one to the launcher:
 * `getAliveDaemonSessionCount()` returns null ("could not verify"), the preserve
 * gate at daemon-init.ts:594 requires `!== null && > 0`, so the run fell through
 * to `killStaleDaemon()` — SIGTERM, then SIGKILL after 3s. There is no fd
 * handoff, so every agent PTY died with it.
 *
 * The fix gives `killStaleDaemon()` an out-of-band second opinion:
 * `inspectDaemonPtyOwnership()` reads the process table (never the daemon
 * socket, which is exactly what failed) and reports whether the daemon's own
 * process still has live PTY descendants. Under
 * `{ preserveWhenOwningLivePtys: true }` — which daemon-init.ts:625 passes on
 * the `failed_health_check` path only — that evidence vetoes the signal.
 *
 * Both directions run here, back to back, with real processes each time:
 *   PHASE 1 (unguarded, the old behavior callers with a mandate still get):
 *     killStaleDaemon(...) with no options -> daemon killed, agents GONE.
 *   PHASE 2 (guarded, the fix):
 *     killStaleDaemon(..., { preserveWhenOwningLivePtys: true }) ->
 *     { killed: false, liveOwnerSurvived: true }, daemon never signalled,
 *     agents STILL ALIVE (confirmed with ps, and again after SIGCONT — a
 *     pending SIGTERM would have felled it on resume).
 *   PHASE 3 (the launcher actually turns it on): daemon-init.ts must pass the
 *     options bag in the argument slot killStaleDaemon reads it from. A guard
 *     enabled one slot over is silently ignored and phase 2 proves nothing about
 *     production.
 *
 * SIGSTOP is the faithful stand-in for the wedge: the socket still accepts
 * connections (probeSocket passes) while no RPC is ever answered — exactly the
 * "busy machine can time out the health check on a live daemon" case the code
 * calls out at daemon-init.ts:581.
 *
 * Real processes throughout: the built daemon-entry.js is forked with
 * production argv, real PTY sessions run uniquely tagged marker processes
 * standing in for coding agents, and the kill decision is driven by the real
 * exported primitives.
 *
 * Usage: node config/scripts/daemon-replacement-live-agent-pty-preservation-repro.mjs
 */
import { execFileSync, fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const entryPath = join(repoRoot, 'out', 'main', 'daemon-entry.js')
const READY_TIMEOUT_MS = 30_000
const MARKER_SPAWN_TIMEOUT_MS = 30_000
const SESSION_COUNT = 2
// Why shortened in phase 2: the grace loop only establishes that the count stays
// unverifiable, which phase 1 already proved exhaustively at ~5s per retry. The
// guarded assertion turns on the PTY-ownership evidence, not the retry count.
const PHASE2_GRACE_RETRIES = 1
const REAL_USER_DAEMON_MARKER = 'Library/Application Support/orca/daemon'

const startedAt = Date.now()
const timeline = []

function log(message) {
  const elapsed = `+${String(Date.now() - startedAt).padStart(6, ' ')}ms`
  timeline.push(`${elapsed}  ${message}`)
  process.stdout.write(`[daemon-pty-preservation] ${elapsed}  ${message}\n`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

// Why read from source: daemon-init.ts imports 'electron' and cannot load outside Electron,
// so the constant that sizes the grace loop is lifted rather than hardcoded (it would drift).
function readSourceConstant(relativePath, pattern) {
  const source = readFileSync(join(repoRoot, relativePath), 'utf8')
  const match = source.match(pattern)
  if (!match) {
    throw new Error(`could not read ${pattern} from ${relativePath}`)
  }
  return Number(match[1])
}

/**
 * Bundles the real daemon primitives into a loadable ESM module.
 *
 * Why: `killStaleDaemon` and friends live in TypeScript modules that the built
 * daemon-entry.js does not re-export. Their import graph is electron-free, so
 * esbuild can produce the genuine code — no reimplementation, no drift.
 */
async function loadDaemonPrimitives(scratch) {
  const esbuild = await import('esbuild')
  const entrySource = join(scratch, 'daemon-primitives-entry.ts')
  const bundlePath = join(scratch, 'daemon-primitives.mjs')
  const daemonDir = join(repoRoot, 'src', 'main', 'daemon')
  writeFileSync(
    entrySource,
    [
      `export { checkDaemonHealth, killStaleDaemon } from ${JSON.stringify(join(daemonDir, 'daemon-health'))}`,
      `export { inspectDaemonPtyOwnership } from ${JSON.stringify(join(daemonDir, 'daemon-live-pty-evidence'))}`,
      `export { getDaemonPidPath, getDaemonSocketPath, getDaemonTokenPath } from ${JSON.stringify(join(daemonDir, 'daemon-spawner'))}`,
      `export { DaemonClient } from ${JSON.stringify(join(daemonDir, 'client'))}`,
      ''
    ].join('\n')
  )
  await esbuild.build({
    entryPoints: [entrySource],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent'
  })
  return import(pathToFileURL(bundlePath).href)
}

// Verbatim from daemon-init.ts probeSocket() — the exact gate the grace loop consults.
function probeSocket(socketPath) {
  return new Promise((resolveProbe) => {
    if (!existsSync(socketPath)) {
      resolveProbe(false)
      return
    }
    const sock = connect({ path: socketPath })
    let settled = false
    const finish = (alive) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      sock.destroy()
      resolveProbe(alive)
    }
    const timer = setTimeout(() => finish(false), 1000)
    sock.on('connect', () => finish(true))
    sock.on('error', () => finish(false))
  })
}

// Verbatim from daemon-init.ts getAliveDaemonSessionCount() — null means "could not verify".
async function getAliveDaemonSessionCount(DaemonClient, socketPath, tokenPath) {
  const client = new DaemonClient({ socketPath, tokenPath })
  try {
    await client.ensureConnected()
    const result = await client.request('listSessions', undefined)
    return result.sessions.filter((session) => session.isAlive).length
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}

function processArgs(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 5_000
    }).trim()
  } catch {
    return null
  }
}

function processState(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'stat='], {
      encoding: 'utf8',
      timeout: 5_000
    }).trim()
  } catch {
    return null
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

// Why scan by tag rather than trust the session pid: macOS wraps the PTY in
// /usr/bin/login for TCC attribution, so the agent process is a descendant of
// the session leader — exactly as a real `claude`/`codex` launch would be.
function findTaggedPid(tag) {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      timeout: 5_000
    })
    for (const line of output.split('\n')) {
      if (line.includes(tag)) {
        const pid = Number(line.trim().split(/\s+/, 1)[0])
        if (Number.isInteger(pid) && pid > 0) {
          return pid
        }
      }
    }
  } catch {
    // ps failed; treat as not found.
  }
  return null
}

function isMarkerAlive(marker) {
  return processArgs(marker.pid)?.includes(marker.tag) === true
}

// Pre-existing daemons (the user's real one above all) must be untouched by this run.
function snapshotForeignDaemons() {
  const daemons = []
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 5_000 })
    for (const line of output.split('\n')) {
      if (!line.includes('daemon-entry.js')) {
        continue
      }
      const pid = Number(line.trim().split(/\s+/, 1)[0])
      if (Number.isInteger(pid) && pid > 0) {
        daemons.push({ pid, isRealUserDaemon: line.includes(REAL_USER_DAEMON_MARKER) })
      }
    }
  } catch {
    // ps failed; the exit check will report an empty snapshot.
  }
  return daemons
}

async function waitFor(predicate, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

function forkDaemon({ runtimeDir, socketPath, tokenPath, pidPath, launchNonce, logFile }) {
  // Argv and spawn options mirror daemon-init.ts createOutOfProcessLauncher().
  const child = fork(
    entryPath,
    [
      '--socket',
      socketPath,
      '--token',
      tokenPath,
      '--pid-record',
      pidPath,
      '--launch-nonce',
      launchNonce,
      '--entry-path',
      entryPath,
      '--app-version',
      'daemon-pty-preservation-repro',
      '--spawner-exec-path',
      process.execPath,
      '--log-file',
      logFile
    ],
    {
      cwd: runtimeDir,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_USER_DATA_PATH: runtimeDir
      }
    }
  )
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(
      () => rejectReady(new Error(`daemon never signaled ready.\nstderr:\n${stderr}`)),
      READY_TIMEOUT_MS
    )
    child.on('message', (msg) => {
      if (msg && typeof msg === 'object' && msg.type === 'ready') {
        clearTimeout(timer)
        resolveReady()
      }
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      rejectReady(new Error(`daemon exited (code=${code}, signal=${signal}).\nstderr:\n${stderr}`))
    })
  })
  return { child, ready }
}

async function startMarkerSession(client, phase, index, runtimeDir) {
  const tag = `ORCA_LIVE_AGENT_MARKER_P${phase}_${index}_${randomUUID().replaceAll('-', '')}`
  const sessionId = `repro-session-${phase}-${index}-${randomUUID()}`
  // Long-lived and uniquely identifiable: stands in for a running coding agent.
  const command = `exec /bin/sh -c 'while :; do sleep 1; done' ${tag}`
  const result = await client.request('createOrAttach', {
    sessionId,
    cols: 80,
    rows: 24,
    cwd: runtimeDir,
    command,
    shellReadySupported: false
  })
  if (!Number.isInteger(result.pid) || result.pid <= 0) {
    throw new Error(`session ${index} reported no pid: ${JSON.stringify(result)}`)
  }
  let markerPid = null
  await waitFor(
    () => (markerPid = findTaggedPid(tag)) !== null,
    `agent marker ${index} to start`,
    MARKER_SPAWN_TIMEOUT_MS
  )
  return { tag, sessionId, pid: markerPid, sessionPid: result.pid }
}

/**
 * Stands up a real daemon with real agent processes, wedges it with SIGSTOP, and
 * replays the launcher's decision inputs against it. Returns everything the phase
 * needs to then call killStaleDaemon() the way its caller would.
 */
async function stageWedgedDaemon({
  primitives,
  scratch,
  phase,
  graceRetries,
  graceNote,
  registry
}) {
  const { DaemonClient, checkDaemonHealth, inspectDaemonPtyOwnership } = primitives
  const runtimeDir = join(scratch, `daemon-phase-${phase}`)
  mkdirSync(runtimeDir, { recursive: true })
  const socketPath = primitives.getDaemonSocketPath(runtimeDir)
  const tokenPath = primitives.getDaemonTokenPath(runtimeDir)
  const pidPath = primitives.getDaemonPidPath(runtimeDir)
  log(`phase ${phase}: runtime dir ${runtimeDir} (real userData is untouched)`)

  const daemon = forkDaemon({
    runtimeDir,
    socketPath,
    tokenPath,
    pidPath,
    launchNonce: randomUUID(),
    logFile: join(scratch, `daemon-phase-${phase}.log`)
  })
  const staged = { daemon, markers: [], stopped: false, runtimeDir, socketPath, tokenPath, pidPath }
  // Registered before the first await so a mid-staging failure still tears it down.
  registry.push(staged)
  await daemon.ready
  log(`phase ${phase}: daemon ready, pid ${daemon.child.pid}`)

  const client = new DaemonClient({ socketPath, tokenPath })
  await client.ensureConnected()
  for (let index = 0; index < SESSION_COUNT; index++) {
    staged.markers.push(await startMarkerSession(client, phase, index, runtimeDir))
  }
  const liveBefore = await getAliveDaemonSessionCount(DaemonClient, socketPath, tokenPath)
  client.disconnect()
  for (const marker of staged.markers) {
    log(
      `phase ${phase}: live agent process pid ${marker.pid} (PTY session leader ${marker.sessionPid}): ${processArgs(marker.pid)}`
    )
  }
  assert(staged.markers.every(isMarkerAlive), 'agent markers were not alive before the wedge')
  log(
    `phase ${phase}: ps confirms ${staged.markers.length} live agent processes; daemon reports ${liveBefore} alive`
  )

  process.kill(daemon.child.pid, 'SIGSTOP')
  staged.stopped = true
  log(`phase ${phase}: SIGSTOP -> daemon ${daemon.child.pid} is ALIVE but cannot service RPCs`)
  assert(staged.markers.every(isMarkerAlive), 'the wedge itself killed the agent markers')
  log(`phase ${phase}: agent processes unaffected by the wedge — only the daemon is unresponsive`)

  // Reproduce the launcher's decision inputs with the real primitives.
  const health = await checkDaemonHealth(socketPath, tokenPath)
  log(
    `phase ${phase}: checkDaemonHealth() = '${health}' (daemon-init.ts:494 takes the else branch)`
  )
  assert(health === 'unreachable', `expected health 'unreachable', got '${health}'`)
  const socketAlive = await probeSocket(socketPath)
  log(`phase ${phase}: probeSocket() = ${socketAlive} — the endpoint still accepts connections`)
  assert(socketAlive, 'the wedged daemon stopped accepting connections; not the modeled failure')

  let liveSessionCount = await getAliveDaemonSessionCount(DaemonClient, socketPath, tokenPath)
  log(
    `phase ${phase}: getAliveDaemonSessionCount() = ${liveSessionCount} (null = could not verify)`
  )
  assert(liveSessionCount === null, 'the wedged daemon answered listSessions; wedge not severe')
  let graceRetry = 0
  while (
    liveSessionCount === null &&
    health !== 'rejected' &&
    graceRetry < graceRetries &&
    (await probeSocket(socketPath))
  ) {
    liveSessionCount = await getAliveDaemonSessionCount(DaemonClient, socketPath, tokenPath)
    graceRetry++
  }
  log(
    `phase ${phase}: grace loop exhausted after ${graceRetry} retries, liveSessions still ${liveSessionCount}${graceNote ? ` (${graceNote})` : ''}`
  )
  assert(
    !(liveSessionCount !== null && liveSessionCount > 0),
    'the preserve gate held; the wedge was not severe enough'
  )
  log(
    `phase ${phase}: preserve gate (daemon-init.ts:594) requires liveSessionCount !== null && > 0 — ` +
      `NOT taken, even though ${staged.markers.length} agents are running right now`
  )

  // The positive, out-of-band evidence the fix turns on — read from the process
  // table, never from the socket the daemon has already failed to answer.
  const ownership = await inspectDaemonPtyOwnership(daemon.child.pid)
  log(`phase ${phase}: inspectDaemonPtyOwnership(${daemon.child.pid}) = '${ownership}'`)
  assert(
    ownership === 'owns-live-ptys',
    `expected 'owns-live-ptys' for the wedged daemon, got '${ownership}'`
  )

  return staged
}

async function runUnguardedPhase(primitives, scratch, graceRetries, registry) {
  const staged = await stageWedgedDaemon({ primitives, scratch, phase: 1, graceRetries, registry })
  log('phase 1: invoking the real killStaleDaemon() with NO options — the unguarded contract')
  const killOutcome = await primitives.killStaleDaemon(
    staged.runtimeDir,
    staged.socketPath,
    staged.tokenPath
  )
  log(`phase 1: killStaleDaemon() = ${JSON.stringify(killOutcome)}`)
  staged.stopped = false
  assert(killOutcome.killed === true, 'unguarded killStaleDaemon() did not kill the daemon')
  assert(
    !isProcessAlive(staged.daemon.child.pid),
    'unguarded killStaleDaemon() left the daemon process alive'
  )

  await waitFor(
    () => staged.markers.every((marker) => !isMarkerAlive(marker)),
    'agent processes to die with the replaced daemon',
    10_000
  )
  for (const marker of staged.markers) {
    log(
      `phase 1: agent PTY pid ${marker.pid} is GONE (ps: ${processArgs(marker.pid) ?? 'no such process'})`
    )
  }
  log('phase 1 RESULT: unguarded replacement killed the daemon and every live agent with it')
  return staged
}

async function runGuardedPhase(primitives, scratch, registry) {
  const staged = await stageWedgedDaemon({
    primitives,
    scratch,
    phase: 2,
    registry,
    graceRetries: PHASE2_GRACE_RETRIES,
    graceNote: `grace loop deliberately shortened to ${PHASE2_GRACE_RETRIES} retry — phase 1 already proved the full loop stays unverifiable; the guarded assertion turns on PTY-ownership evidence`
  })
  const daemonPid = staged.daemon.child.pid
  // The signature takes a single trailing options bag (test seams and production options
  // together) precisely so there is no adjacent slot to mis-target; phase 3 still pins the
  // launcher's call shape so a future re-split cannot silently disable the guard.
  log(
    'phase 2: invoking the real killStaleDaemon(runtimeDir, socket, token, PROTOCOL_VERSION, ' +
      '{ preserveWhenOwningLivePtys: true })'
  )
  const killOutcome = await primitives.killStaleDaemon(
    staged.runtimeDir,
    staged.socketPath,
    staged.tokenPath,
    undefined,
    { preserveWhenOwningLivePtys: true }
  )
  log(`phase 2: killStaleDaemon() = ${JSON.stringify(killOutcome)}`)
  assert(
    killOutcome.killed === false && killOutcome.liveOwnerSurvived === true,
    `expected {killed:false,liveOwnerSurvived:true}, got ${JSON.stringify(killOutcome)}`
  )

  assert(isProcessAlive(daemonPid), 'the guarded call killed the daemon anyway')
  log(
    `phase 2: daemon ${daemonPid} is STILL ALIVE (ps stat '${processState(daemonPid)}' — T = stopped, not killed)`
  )
  assert(existsSync(staged.pidPath), 'the guarded call removed the surviving daemon PID record')
  log('phase 2: PID record left intact — no replacement can publish ownership beside it')

  for (const marker of staged.markers) {
    assert(isMarkerAlive(marker), `agent PTY pid ${marker.pid} died despite the preserve guard`)
    log(`phase 2: agent PTY pid ${marker.pid} is ALIVE (ps: ${processArgs(marker.pid)})`)
  }

  // Why SIGCONT: a SIGTERM sent to a stopped process stays pending and lands on
  // resume. Surviving the resume is the proof that no signal was even queued.
  process.kill(daemonPid, 'SIGCONT')
  staged.stopped = false
  await new Promise((r) => setTimeout(r, 1_000))
  assert(isProcessAlive(daemonPid), 'the daemon died on SIGCONT — a SIGTERM had been queued for it')
  log(`phase 2: after SIGCONT the daemon is still running — no signal was ever delivered to it`)
  const resumedHealth = await primitives.checkDaemonHealth(staged.socketPath, staged.tokenPath)
  const resumedSessions = await getAliveDaemonSessionCount(
    primitives.DaemonClient,
    staged.socketPath,
    staged.tokenPath
  )
  log(
    `phase 2: resumed daemon reports checkDaemonHealth() = '${resumedHealth}', getAliveDaemonSessionCount() = ${resumedSessions}`
  )
  assert(resumedHealth === 'healthy', `resumed daemon is not healthy: '${resumedHealth}'`)
  assert(resumedSessions === SESSION_COUNT, `resumed daemon lost sessions: ${resumedSessions}`)
  for (const marker of staged.markers) {
    assert(isMarkerAlive(marker), `agent PTY pid ${marker.pid} died during resume`)
  }
  log('phase 2 RESULT: guarded replacement refused to signal; daemon and all live agents survived')
  return staged
}

/**
 * Splits a call's (or declaration's) argument list at top level, so `{ a: 1 }` counts as
 * one argument. Returns null if the list is not balanced within `source`.
 */
function splitCallArguments(source, openParenIndex) {
  const args = []
  let depth = 0
  let current = ''
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i]
    if ('([{'.includes(ch)) {
      depth++
      if (depth === 1) {
        continue
      }
    } else if (')]}'.includes(ch)) {
      depth--
      if (depth === 0) {
        args.push(current.trim())
        return args
      }
    } else if (ch === ',' && depth === 1) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  return null
}

/**
 * Which positional argument of killStaleDaemon carries the options bag, read from the
 * declaration rather than hardcoded: an options object one slot off is silently taken for
 * a different parameter — no type error, no runtime error, guard simply off.
 */
function readOptionsArgumentSlot() {
  const relativePath = 'src/main/daemon/daemon-health.ts'
  // Comments carry commas, which would corrupt the top-level parameter split.
  const source = readFileSync(join(repoRoot, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  const declIndex = source.indexOf('export async function killStaleDaemon(')
  assert(declIndex !== -1, `${relativePath} does not declare killStaleDaemon`)
  const params = splitCallArguments(source, source.indexOf('(', declIndex))
  assert(params !== null, `could not parse the killStaleDaemon signature in ${relativePath}`)
  const index = params.findIndex((param) => param.includes('StaleDaemonKillOptions'))
  assert(index !== -1, 'no killStaleDaemon parameter accepts StaleDaemonKillOptions')
  log(
    `killStaleDaemon(${params.map((param) => param.replace(/\s+/g, ' ')).join(', ')}) — ` +
      `StaleDaemonKillOptions is argument ${index + 1}`
  )
  return index + 1
}

/**
 * The guard only exists if the launcher actually turns it on: an object landing in any slot
 * other than the options one is silently ignored, and every live agent dies exactly as it
 * did before the fix (phase 1).
 */
function checkLauncherEnablesTheGuard(optionsSlot) {
  const relativePath = 'src/main/daemon/daemon-init.ts'
  const source = readFileSync(join(repoRoot, relativePath), 'utf8')
  const marker = source.indexOf('preserveWhenOwningLivePtys')
  assert(marker !== -1, `${relativePath} never passes preserveWhenOwningLivePtys`)
  const callIndex = source.lastIndexOf('killStaleDaemon(', marker)
  assert(callIndex !== -1, `${relativePath} sets preserveWhenOwningLivePtys outside a call`)
  const line = source.slice(0, callIndex).split('\n').length
  const args = splitCallArguments(source, callIndex + 'killStaleDaemon'.length)
  assert(args !== null, `could not parse the killStaleDaemon call at ${relativePath}:${line}`)
  const renderedArgs = args.map((arg) => arg.replace(/\s+/g, ' ')).join(' | ')
  log(
    `phase 3: ${relativePath}:${line} calls killStaleDaemon with ${args.length} arguments: ${renderedArgs}`
  )
  const passedSlot = args.findIndex((arg) => arg.includes('preserveWhenOwningLivePtys')) + 1
  assert(
    passedSlot === optionsSlot,
    `${relativePath}:${line} passes { preserveWhenOwningLivePtys } as argument ${passedSlot}, but ` +
      `killStaleDaemon reads its options from argument ${optionsSlot}. Anywhere else the guard ` +
      `never runs and the launcher still kills live agents exactly as in phase 1.`
  )
  log(
    `phase 3 RESULT: the launcher enables the guard on the failed_health_check path, in argument ${optionsSlot}`
  )
}

function teardown(staged) {
  if (!staged) {
    return
  }
  const daemonPid = staged.daemon?.child.pid
  if (daemonPid) {
    for (const signal of staged.stopped ? ['SIGCONT', 'SIGKILL'] : ['SIGKILL']) {
      try {
        process.kill(daemonPid, signal)
      } catch {
        // already gone
      }
    }
    staged.daemon.child.stderr?.destroy()
    if (staged.daemon.child.connected) {
      staged.daemon.child.disconnect()
    }
    staged.daemon.child.unref()
  }
  for (const marker of staged.markers ?? []) {
    for (const pid of [marker.pid, marker.sessionPid]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
}

async function main() {
  if (process.platform === 'win32') {
    log('SKIP: SIGSTOP is POSIX-only, so a live-but-unresponsive daemon cannot be staged here')
    return
  }
  if (!existsSync(entryPath)) {
    throw new Error(`missing ${entryPath} — run \`pnpm run build:electron-vite\` first`)
  }

  const scratch = mkdtempSync(join(tmpdir(), 'orca-dpp-'))
  const foreignDaemons = snapshotForeignDaemons()
  const staged = []
  let verdict = 'FAIL'

  try {
    log(
      `pre-existing daemons that must survive this run: ${foreignDaemons
        .map((d) => `${d.pid}${d.isRealUserDaemon ? ' (real userData daemon)' : ''}`)
        .join(', ')}`
    )
    const primitives = await loadDaemonPrimitives(scratch)
    const optionsSlot = readOptionsArgumentSlot()
    const graceRetries = readSourceConstant(
      'src/main/daemon/daemon-init.ts',
      /WEDGED_DAEMON_GRACE_RETRIES = (\d+)/
    )

    log('=== PHASE 1 (BEFORE / unguarded): killStaleDaemon() with no options ===')
    await runUnguardedPhase(primitives, scratch, graceRetries, staged)

    log('=== PHASE 2 (AFTER / guarded): killStaleDaemon(..., preserveWhenOwningLivePtys) ===')
    await runGuardedPhase(primitives, scratch, staged)

    log('=== PHASE 3: does the launcher actually enable the guard? ===')
    checkLauncherEnablesTheGuard(optionsSlot)

    verdict = 'PASS'
  } finally {
    for (const phase of staged) {
      teardown(phase)
    }
    rmSync(scratch, { recursive: true, force: true })

    const survivors = foreignDaemons.filter((d) => isProcessAlive(d.pid))
    // Why only the real userData daemon is fatal: orphaned test daemons idle-shut-down or
    // death-watch out on their own schedule, so their exit during a 90s run proves nothing.
    const realUserDaemons = foreignDaemons.filter((d) => d.isRealUserDaemon)
    const harmedRealDaemons = realUserDaemons.filter((d) => !isProcessAlive(d.pid))
    const departed = foreignDaemons.filter((d) => !isProcessAlive(d.pid) && !d.isRealUserDaemon)
    const departedNote =
      departed.length > 0
        ? ` (unrelated daemons that exited on their own: ${departed.map((d) => d.pid).join(', ')})`
        : ''
    log(
      `cleanup done; pre-existing daemons still running: ${survivors.map((d) => d.pid).join(', ') || 'none'}${departedNote}`
    )
    log(
      harmedRealDaemons.length > 0
        ? `THE REAL userData DAEMON WAS HARMED: ${harmedRealDaemons.map((d) => d.pid).join(', ')}`
        : `real userData daemon untouched: ${realUserDaemons.map((d) => d.pid).join(', ') || 'none running'}`
    )
    if (harmedRealDaemons.length > 0) {
      verdict = 'FAIL'
    }

    process.stdout.write(
      `\n[daemon-pty-preservation] TIMELINE\n${timeline.map((line) => `  ${line}`).join('\n')}\n`
    )
    process.stdout.write(
      verdict === 'PASS'
        ? '\n[daemon-pty-preservation] PASS (both directions proved): unguarded killStaleDaemon() still kills a wedged daemon and every agent PTY with it; the guarded call refuses to signal a daemon whose process owns live PTYs — daemon and agents survive; and the launcher passes the guard in the argument slot that turns it on.\n'
        : '\n[daemon-pty-preservation] FAIL: live agent PTYs are NOT protected — see the ERROR line and the timeline above.\n'
    )
    process.exitCode = verdict === 'PASS' ? 0 : 1
  }
}

main().catch((error) => {
  process.stderr.write(`[daemon-pty-preservation] ERROR: ${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
