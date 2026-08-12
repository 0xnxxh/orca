#!/usr/bin/env node
/**
 * Regression proof: daemon replacement must not kill live coding-agent terminals.
 *
 * The protection is no longer a veto inside `killStaleDaemon()` — that was policy
 * buried in a mechanism. `killStaleDaemon()` is now purely "make this pid go away"
 * and will happily kill a daemon that is hosting live agents. The decision moved
 * up to the launcher, ahead of any kill:
 *
 *   readVerifiedDaemonPid()  -> which process, identity-verified, is the daemon
 *   resolveDaemonOccupancy() -> is it hosting work, and how sure are we
 *   daemon-init.ts           -> 'occupied' with an unverifiable count => HOLD
 *
 * `resolveDaemonOccupancy()` asks the daemon over IPC first (a reply is
 * authoritative both ways); only when it cannot answer does it consult the OS
 * process table via `inspectDaemonPtyOwnership()`, and that evidence may only
 * RAISE the answer to 'occupied' — it can never prove 'empty'.
 *
 * Three phases, real processes throughout:
 *   PHASE 1 (the danger is real): a SIGSTOPped daemon owning 2 live agent
 *     processes presents exactly the launcher's inputs — health 'unreachable',
 *     an endpoint that is NOT proven dead, no IPC session count. Calling
 *     killStaleDaemon() directly at that moment kills the daemon and both agents.
 *     This is what the decision is protecting against, not a bug in the kill.
 *   PHASE 2 (the decision protects it): same staging, fresh daemon and agents.
 *     readVerifiedDaemonPid() names the daemon, resolveDaemonOccupancy() returns
 *     { state: 'occupied', liveSessions: null } — IPC could not answer, the
 *     process table raised it to occupied — which is the exact input that makes
 *     the launcher hold. Nothing is signalled: daemon and agents are alive, and
 *     after SIGCONT the daemon is healthy and reports its 2 sessions again, so
 *     the wedge was transient and the preserved work was genuinely recoverable.
 *   PHASE 3 (the launcher actually holds): daemon-init.ts imports electron and
 *     cannot be executed here, so its failed-health-check branch is verified
 *     statically — the 'occupied' branch returns holdIncumbentDaemon() and
 *     contains no kill, and every killStaleDaemon() call sits after it.
 *
 * SIGSTOP is the faithful stand-in for the wedge: the socket still accepts
 * connections while no RPC is ever answered — exactly the "busy machine can time
 * out the health check on a live daemon" case daemon-init.ts calls out.
 *
 * Usage: node config/scripts/daemon-replacement-live-agent-pty-preservation-repro.mjs
 */
import { execFileSync, fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const entryPath = join(repoRoot, 'out', 'main', 'daemon-entry.js')
const READY_TIMEOUT_MS = 30_000
const MARKER_SPAWN_TIMEOUT_MS = 30_000
const SESSION_COUNT = 2
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
  const match = readFileSync(join(repoRoot, relativePath), 'utf8').match(pattern)
  assert(match !== null, `could not read ${pattern} from ${relativePath}`)
  return Number(match[1])
}

/**
 * Bundles the real daemon primitives into a loadable ESM module.
 *
 * Why: the decision primitives live in TypeScript modules that the built
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
      `export { checkDaemonHealth, killStaleDaemon, readVerifiedDaemonPid } from ${JSON.stringify(join(daemonDir, 'daemon-health'))}`,
      `export { resolveDaemonOccupancy } from ${JSON.stringify(join(daemonDir, 'daemon-occupancy'))}`,
      `export { endpointIsProvenDead, probeSocketConnect } from ${JSON.stringify(join(daemonDir, 'daemon-endpoint-probe'))}`,
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

// Same shape as daemon-occupancy.ts countLiveSessionsOverIpc(): null means "could not answer".
async function countLiveSessionsOverIpc(DaemonClient, socketPath, tokenPath) {
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
 * Stands up a real daemon with real agent processes, wedges it with SIGSTOP, and replays
 * the launcher's decision inputs against it — the state both phases start from.
 */
async function stageWedgedDaemon({ primitives, scratch, phase, registry }) {
  const { DaemonClient, checkDaemonHealth, endpointIsProvenDead, probeSocketConnect } = primitives
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
  const liveBefore = await countLiveSessionsOverIpc(DaemonClient, socketPath, tokenPath)
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

  // The launcher's own inputs on the failed-health-check path, via the real primitives.
  const health = await checkDaemonHealth(socketPath, tokenPath)
  log(`phase ${phase}: checkDaemonHealth() = '${health}' — daemon-init.ts takes the else branch`)
  assert(health === 'unreachable', `expected health 'unreachable', got '${health}'`)

  const probe = await probeSocketConnect(socketPath)
  log(
    `phase ${phase}: probeSocketConnect() = '${probe}', endpointIsProvenDead() = ${endpointIsProvenDead(probe)} — nothing proves the daemon is gone`
  )
  assert(
    !endpointIsProvenDead(probe),
    `the wedged daemon's endpoint was proven dead ('${probe}'); not the modeled failure`
  )

  const ipcCount = await countLiveSessionsOverIpc(DaemonClient, socketPath, tokenPath)
  log(
    `phase ${phase}: live session count over IPC = ${ipcCount} (null = the daemon could not answer)`
  )
  assert(ipcCount === null, 'the wedged daemon answered listSessions; wedge not severe enough')

  return staged
}

/**
 * PHASE 1 — what the decision is protecting against. killStaleDaemon() is now a pure
 * mechanism with no opinion about live work, so called at this exact moment it takes the
 * daemon and every agent PTY with it.
 */
async function runUnprotectedKillPhase(primitives, scratch, registry) {
  const staged = await stageWedgedDaemon({ primitives, scratch, phase: 1, registry })
  log(
    'phase 1: invoking the real killStaleDaemon(runtimeDir, socket, token) directly — no occupancy consulted'
  )
  const killOutcome = await primitives.killStaleDaemon(
    staged.runtimeDir,
    staged.socketPath,
    staged.tokenPath
  )
  log(`phase 1: killStaleDaemon() = ${JSON.stringify(killOutcome)}`)
  staged.stopped = false
  assert(killOutcome.killed === true, 'killStaleDaemon() did not kill the wedged daemon')
  assert(!isProcessAlive(staged.daemon.child.pid), 'killStaleDaemon() left the daemon alive')

  await waitFor(
    () => staged.markers.every((marker) => !isMarkerAlive(marker)),
    'agent processes to die with the killed daemon',
    10_000
  )
  for (const marker of staged.markers) {
    log(
      `phase 1: agent PTY pid ${marker.pid} is GONE (ps: ${processArgs(marker.pid) ?? 'no such process'})`
    )
  }
  log(
    'phase 1 RESULT: the danger is real — killStaleDaemon() on a wedged-but-live daemon ends the daemon and every agent with it. There is no fd handoff; only a decision taken BEFORE the kill can save them.'
  )
  return staged
}

/**
 * PHASE 2 — the decision the launcher takes instead. Identical staging, but the inputs are
 * resolved rather than acted on: readVerifiedDaemonPid() names the process and
 * resolveDaemonOccupancy() raises it to 'occupied' from the process table.
 */
async function runOccupancyDecisionPhase(primitives, scratch, graceRetries, registry) {
  const staged = await stageWedgedDaemon({ primitives, scratch, phase: 2, registry })
  const daemonPid = staged.daemon.child.pid

  const verifiedPid = await primitives.readVerifiedDaemonPid(
    staged.runtimeDir,
    staged.socketPath,
    staged.tokenPath
  )
  log(
    `phase 2: readVerifiedDaemonPid() = ${verifiedPid ? `pid ${verifiedPid.pid} (identity verified: cmdline + start time)` : 'null'}`
  )
  assert(
    verifiedPid?.pid === daemonPid,
    `readVerifiedDaemonPid() returned ${JSON.stringify(verifiedPid)}, expected pid ${daemonPid}`
  )

  // Which input answered is readable from the result alone: resolveDaemonOccupancy only ever
  // returns a null count when IPC failed and inspectDaemonPtyOwnership() — the OS process
  // table, never the socket the daemon already failed to answer — reported 'owns-live-ptys'.
  let occupancy = await primitives.resolveDaemonOccupancy({
    socketPath: staged.socketPath,
    tokenPath: staged.tokenPath,
    recordedPid: verifiedPid.pid
  })
  log(`phase 2: resolveDaemonOccupancy() = ${JSON.stringify(occupancy)}`)
  // The launcher's grace loop, replayed verbatim: it only re-samples while 'unknown'.
  let graceRetry = 0
  while (
    occupancy.state === 'unknown' &&
    graceRetry < graceRetries &&
    !primitives.endpointIsProvenDead(await primitives.probeSocketConnect(staged.socketPath))
  ) {
    occupancy = await primitives.resolveDaemonOccupancy({
      socketPath: staged.socketPath,
      tokenPath: staged.tokenPath,
      recordedPid: verifiedPid.pid
    })
    graceRetry++
  }
  log(
    `phase 2: grace loop (WEDGED_DAEMON_GRACE_RETRIES = ${graceRetries}) ran ${graceRetry} retries — it only re-samples while the state is 'unknown', and this never was`
  )
  assert(
    occupancy.state === 'occupied' && occupancy.liveSessions === null,
    `expected {state:'occupied',liveSessions:null}, got ${JSON.stringify(occupancy)}`
  )
  log(
    "phase 2: occupancy is 'occupied' with liveSessions null — IPC could not answer, so the count came from the process table. That exact pair is what makes the launcher hold instead of kill (phase 3)."
  )

  assert(isProcessAlive(daemonPid), 'the daemon died while occupancy was being resolved')
  log(
    `phase 2: daemon ${daemonPid} is STILL ALIVE (ps stat '${processState(daemonPid)}' — T = stopped, not killed); resolving occupancy signals nothing`
  )
  assert(existsSync(staged.pidPath), 'the surviving daemon lost its PID record')
  log('phase 2: PID record left intact — no replacement can publish ownership beside it')

  for (const marker of staged.markers) {
    assert(isMarkerAlive(marker), `agent PTY pid ${marker.pid} died during the decision`)
    log(`phase 2: agent PTY pid ${marker.pid} is ALIVE (ps: ${processArgs(marker.pid)})`)
  }

  // Why SIGCONT: a SIGTERM sent to a stopped process stays pending and lands on
  // resume. Surviving the resume is the proof that no signal was even queued.
  process.kill(daemonPid, 'SIGCONT')
  staged.stopped = false
  await new Promise((r) => setTimeout(r, 1_000))
  assert(isProcessAlive(daemonPid), 'the daemon died on SIGCONT — a SIGTERM had been queued for it')
  log('phase 2: after SIGCONT the daemon is still running — no signal was ever delivered to it')

  const resumedHealth = await primitives.checkDaemonHealth(staged.socketPath, staged.tokenPath)
  const resumedSessions = await countLiveSessionsOverIpc(
    primitives.DaemonClient,
    staged.socketPath,
    staged.tokenPath
  )
  log(
    `phase 2: resumed daemon reports checkDaemonHealth() = '${resumedHealth}', live sessions over IPC = ${resumedSessions}`
  )
  assert(resumedHealth === 'healthy', `resumed daemon is not healthy: '${resumedHealth}'`)
  assert(resumedSessions === SESSION_COUNT, `resumed daemon lost sessions: ${resumedSessions}`)
  for (const marker of staged.markers) {
    assert(isMarkerAlive(marker), `agent PTY pid ${marker.pid} died during resume`)
  }
  const resumedOccupancy = await primitives.resolveDaemonOccupancy({
    socketPath: staged.socketPath,
    tokenPath: staged.tokenPath,
    recordedPid: verifiedPid.pid
  })
  log(
    `phase 2: resolveDaemonOccupancy() on the recovered daemon = ${JSON.stringify(resumedOccupancy)} — the count is authoritative again now that IPC answers`
  )
  assert(
    resumedOccupancy.state === 'occupied' && resumedOccupancy.liveSessions === SESSION_COUNT,
    `expected {state:'occupied',liveSessions:${SESSION_COUNT}} after recovery, got ${JSON.stringify(resumedOccupancy)}`
  )
  log(
    'phase 2 RESULT: the wedge was transient and the work was genuinely recoverable — the daemon and both agents survived, then came back healthy with all sessions intact'
  )
  return staged
}

function stripComments(source) {
  // Blanked rather than deleted so offsets and line numbers stay true to the real file.
  const blank = (text) => text.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_match, prefix, comment) => prefix + blank(comment))
}

/** The balanced `{...}` block starting at `braceIndex`, or null if it never closes. */
function extractBlock(source, braceIndex) {
  let depth = 0
  for (let i = braceIndex; i < source.length; i++) {
    if (source[i] === '{') {
      depth++
    } else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        return { text: source.slice(braceIndex, i + 1), start: braceIndex, end: i + 1 }
      }
    }
  }
  return null
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

function normalize(text) {
  return text.replace(/\s+/g, ' ')
}

/**
 * PHASE 3 — the launcher must hold rather than kill. daemon-init.ts imports electron, so it
 * cannot be executed here; this reads the source instead, whitespace-tolerantly, and asserts
 * the structural properties phase 2's inputs depend on.
 */
function checkLauncherHoldsOccupiedDaemon() {
  const relativePath = 'src/main/daemon/daemon-init.ts'
  const source = stripComments(readFileSync(join(repoRoot, relativePath), 'utf8'))

  // 1. holdIncumbentDaemon() returns a preserved handle in 'held' mode — it does not adopt,
  //    which a daemon too wedged to answer listSessions could never complete anyway.
  const holdDecl = source.match(/const\s+holdIncumbentDaemon\s*=\s*\([^)]*\)[^{]*\{/)
  assert(holdDecl !== null, `${relativePath} does not declare holdIncumbentDaemon()`)
  const holdBody = extractBlock(source, holdDecl.index + holdDecl[0].length - 1)
  assert(holdBody !== null, `could not parse the holdIncumbentDaemon() body in ${relativePath}`)
  assert(
    /createPreservedDaemonHandle\([^)]*'held'\s*\)/.test(normalize(holdBody.text)),
    `holdIncumbentDaemon() does not return createPreservedDaemonHandle(..., 'held'): ${normalize(holdBody.text)}`
  )
  log(
    `phase 3: ${relativePath}:${lineOf(source, holdDecl.index)} holdIncumbentDaemon() = ${normalize(holdBody.text)}`
  )

  // 2. The failed-health-check path resolves occupancy from an identity-verified pid.
  const verifiedPidCall = source.search(/readVerifiedDaemonPid\s*\(/)
  const occupancyCall = source.search(/resolveDaemonOccupancy\s*\(\s*\{/)
  assert(verifiedPidCall !== -1, `${relativePath} never calls readVerifiedDaemonPid()`)
  assert(occupancyCall !== -1, `${relativePath} never calls resolveDaemonOccupancy()`)
  assert(
    verifiedPidCall < occupancyCall,
    `${relativePath} resolves occupancy before verifying the recorded pid — the evidence could then describe a recycled pid's children`
  )

  // 3. The 'occupied' branch holds and never kills.
  const occupiedGuard = source.match(/if\s*\(\s*occupancy\.state\s*===\s*'occupied'\s*\)\s*\{/)
  assert(occupiedGuard !== null, `${relativePath} has no 'occupancy.state === occupied' guard`)
  const occupiedBlock = extractBlock(source, occupiedGuard.index + occupiedGuard[0].length - 1)
  assert(occupiedBlock !== null, `could not parse the occupied branch in ${relativePath}`)
  const occupiedLine = lineOf(source, occupiedGuard.index)
  assert(
    !occupiedBlock.text.includes('killStaleDaemon'),
    `${relativePath}:${occupiedLine} calls killStaleDaemon inside the occupied branch`
  )

  // Holding requires BOTH: no hello ever completed, and only the process table could answer.
  // A daemon that did complete a hello is adoptable, so it must not be routed to a mode that
  // never adopts.
  const unverifiableGuard = occupiedBlock.text.match(
    /if\s*\(\s*health\s*===\s*'unreachable'\s*&&\s*occupancy\.liveSessions\s*===\s*null\s*\)\s*\{/
  )
  assert(
    unverifiableGuard !== null,
    `${relativePath}:${occupiedLine} does not gate the hold on an unreachable daemon with an unverifiable (null) session count`
  )
  const unverifiableBlock = extractBlock(
    occupiedBlock.text,
    unverifiableGuard.index + unverifiableGuard[0].length - 1
  )
  assert(unverifiableBlock !== null, 'could not parse the liveSessions === null branch')
  assert(
    normalize(unverifiableBlock.text).includes('return holdIncumbentDaemon()'),
    `${relativePath}:${occupiedLine} does not return holdIncumbentDaemon() when the session count came from the process table`
  )
  log(
    `phase 3: ${relativePath}:${occupiedLine} occupancy.state === 'occupied' && occupancy.liveSessions === null -> return holdIncumbentDaemon(); the branch contains no kill`
  )

  // 4. Ordering: every kill on this path is downstream of the occupied branch, so a hold
  //    returns before any of them can run.
  const killCalls = [...source.matchAll(/killStaleDaemon\s*\(/g)].map((match) => match.index)
  assert(killCalls.length > 0, `${relativePath} never calls killStaleDaemon()`)
  const killsBeforeTheDecision = killCalls.filter(
    (index) => index > occupancyCall && index < occupiedBlock.end
  )
  assert(
    killsBeforeTheDecision.length === 0,
    `${relativePath} kills at line(s) ${killsBeforeTheDecision.map((i) => lineOf(source, i)).join(', ')}, between resolving occupancy and the hold`
  )
  const fallThroughKill = killCalls.find((index) => index > occupiedBlock.end)
  assert(
    fallThroughKill !== undefined,
    `${relativePath} has no killStaleDaemon() after the occupied branch — the replacement path is gone`
  )
  const killLines = killCalls.map((index) => lineOf(source, index)).join(', ')
  log(
    `phase 3: every killStaleDaemon() call site in the file is at line(s) ${killLines} — all downstream of the occupied branch, which returns at line ${lineOf(source, occupiedBlock.start)}`
  )
  log(
    'phase 3 RESULT: statically, the failed-health-check path resolves occupancy from a verified pid and returns a held handle before any kill. This proves the source ordering and branch contents; it does NOT execute daemon-init.ts (it imports electron), so the runtime proof stops at the inputs phase 2 produced with real processes.'
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
    const graceRetries = readSourceConstant(
      'src/main/daemon/daemon-init.ts',
      /WEDGED_DAEMON_GRACE_RETRIES = (\d+)/
    )

    log('=== PHASE 1: the danger is real — killStaleDaemon() has no opinion about live work ===')
    await runUnprotectedKillPhase(primitives, scratch, staged)

    log('=== PHASE 2: the decision protects it — resolveDaemonOccupancy() on the same wedge ===')
    await runOccupancyDecisionPhase(primitives, scratch, graceRetries, staged)

    log('=== PHASE 3: does the launcher actually hold on that verdict? ===')
    checkLauncherHoldsOccupiedDaemon()

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
        ? '\n[daemon-pty-preservation] PASS: killStaleDaemon() on a wedged daemon still kills it and every agent PTY with it (phase 1); against the identical wedge resolveDaemonOccupancy() returns { occupied, liveSessions: null } from the process table with the daemon unsignalled, both agents alive, and the daemon recovering healthy with all sessions on SIGCONT (phase 2); and daemon-init.ts returns holdIncumbentDaemon() on that verdict, before any kill (phase 3, static).\n'
        : '\n[daemon-pty-preservation] FAIL: live agent PTYs are NOT protected — see the ERROR line and the timeline above.\n'
    )
    process.exitCode = verdict === 'PASS' ? 0 : 1
  }
}

main().catch((error) => {
  process.stderr.write(`[daemon-pty-preservation] ERROR: ${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
