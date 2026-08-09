#!/usr/bin/env node

import { execFile, execFileSync, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import electronPath from 'electron'
import { MobileHomeSession } from './macos-appkit-dashboard-mobile-session.mjs'

const execFileAsync = promisify(execFile)
const projectDir = path.resolve(import.meta.dirname, '../..')
const evidenceDir = path.resolve(
  process.env.ORCA_APPKIT_REPRO_EVIDENCE_DIR ??
    path.join(projectDir, 'artifacts', 'macos-appkit-dashboard-hang-repro')
)
const durationMinutes = positiveNumber(process.env.ORCA_APPKIT_REPRO_MINUTES, 30)
const activationIntervalMs = positiveNumber(process.env.ORCA_APPKIT_REPRO_ACTIVATION_MS, 15_000)
const agentBrowserPath = path.join(projectDir, 'node_modules', '.bin', 'agent-browser')
const mainEntry = path.join(projectDir, 'out', 'main', 'index.js')
const sessionName = `orca-appkit-repro-${process.pid}`
const runRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-appkit-dashboard-hang-'))
const userDataDir = path.join(runRoot, 'user-data')
const requestedHomeDir = path.join(userDataDir, 'home')
const fixtureRepoDir = path.join(runRoot, 'fixture-repo')
const eventLogPath = path.join(evidenceDir, 'events.ndjson')
const agentBrowserLogPath = path.join(evidenceDir, 'agent-browser.log')

mkdirSync(evidenceDir, { recursive: true })
mkdirSync(userDataDir, { recursive: true })
mkdirSync(requestedHomeDir, { recursive: true, mode: 0o700 })
const isolatedHomeDir = realpathSync.native(requestedHomeDir)

const E2E_RESTRICTED_ENV_KEYS = new Set([
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'CODEX_HOME',
  'ORCA_CODEX_HOME',
  'ORCA_E2E_USER_DATA_DIR',
  'ORCA_E2E_HOME_DIR'
])

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isolatedLaunchEnvironment() {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !E2E_RESTRICTED_ENV_KEYS.has(key.toUpperCase()))
  )
  delete inherited.ELECTRON_RUN_AS_NODE
  return {
    ...inherited,
    HOME: isolatedHomeDir,
    USERPROFILE: isolatedHomeDir,
    NODE_ENV: 'development',
    ORCA_E2E_HEADFUL: '1',
    ORCA_E2E_HOME_DIR: isolatedHomeDir,
    ORCA_E2E_USER_DATA_DIR: userDataDir
  }
}

function log(event, details = {}) {
  const entry = { at: new Date().toISOString(), event, ...details }
  appendFileSync(eventLogPath, `${JSON.stringify(entry)}\n`)
  console.log(JSON.stringify(entry))
}

function seedProfile() {
  mkdirSync(fixtureRepoDir, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: fixtureRepoDir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'appkit-repro@orca.test'], {
    cwd: fixtureRepoDir,
    stdio: 'ignore'
  })
  execFileSync('git', ['config', 'user.name', 'AppKit Repro'], {
    cwd: fixtureRepoDir,
    stdio: 'ignore'
  })
  writeFileSync(path.join(fixtureRepoDir, 'README.md'), '# AppKit dashboard hang fixture\n')
  execFileSync('git', ['add', '-A'], { cwd: fixtureRepoDir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: fixtureRepoDir, stdio: 'ignore' })
  const profile = {
    settings: {
      defaultTuiAgent: 'blank',
      experimentalAgentDashboardPopout: true,
      telemetry: {
        optedIn: true,
        installId: '00000000-0000-4000-8000-000000000000',
        existedBeforeTelemetryRelease: false
      }
    },
    onboarding: {
      flowVersion: 4,
      closedAt: 1,
      outcome: 'completed',
      lastCompletedStep: 5
    },
    repos: [
      {
        id: '00000000-0000-4000-8000-00000000a117',
        path: fixtureRepoDir,
        displayName: 'appkit-repro',
        badgeColor: '#888888',
        addedAt: 1
      }
    ]
  }
  writeFileSync(path.join(userDataDir, 'orca-data.json'), `${JSON.stringify(profile, null, 2)}\n`)
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  await new Promise((resolve) => server.close(resolve))
  if (!port) {
    throw new Error('Could not reserve a CDP port')
  }
  return port
}

async function waitForCdp(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port ${port} did not become ready`)
}

async function agentBrowser(args, options = {}) {
  const startedAt = Date.now()
  try {
    const result = await execFileAsync(agentBrowserPath, ['--session', sessionName, ...args], {
      cwd: projectDir,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 8 * 1024 * 1024
    })
    const output = `${result.stdout}${result.stderr}`
    appendFileSync(agentBrowserLogPath, `\n$ ${args.join(' ')}\n${output}`)
    log('agent_browser_command', { command: args[0], durationMs: Date.now() - startedAt })
    return output
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    appendFileSync(
      agentBrowserLogPath,
      `\n$ ${args.join(' ')}\n${output}\nERROR: ${String(error)}\n`
    )
    throw error
  }
}

async function waitForPopoutTab() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const output = await agentBrowser(['tab', 'list'])
    const lines = output.split('\n')
    const popout = lines.find((line) => line.includes('popout.html'))
    const main = lines.find((line) => /t\d+/.test(line) && !line.includes('popout.html'))
    const popoutId = popout?.match(/\bt\d+\b/)?.[0]
    const mainId = main?.match(/\bt\d+\b/)?.[0]
    if (popoutId && mainId) {
      return { mainId, popoutId, tabList: output }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Agent Dashboard popout target did not appear')
}

async function rendererEval(script, timeoutMs = 30_000) {
  return agentBrowser(['eval', script], { timeoutMs })
}

async function takeWindowEvidence(tabId, name) {
  await agentBrowser(['tab', tabId])
  const snapshot = await agentBrowser(['snapshot', '-i'])
  writeFileSync(path.join(evidenceDir, `${name}.snapshot.txt`), snapshot)
  await agentBrowser(['screenshot', path.join(evidenceDir, `${name}.png`)])
}

async function captureMainSample(pid, reason) {
  log('capturing_main_sample', { pid, reason })
  try {
    await execFileAsync(
      'sample',
      [String(pid), '15', '5', '-file', path.join(evidenceDir, 'main.sample.txt')],
      {
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } catch (error) {
    writeFileSync(path.join(evidenceDir, 'sample-error.txt'), `${String(error)}\n`)
  }
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-axo', 'pid,ppid,state,%cpu,%mem,etime,command'],
      {
        maxBuffer: 4 * 1024 * 1024
      }
    )
    writeFileSync(path.join(evidenceDir, 'processes.txt'), stdout)
  } catch {}
}

function terminateProcessGroup(pid) {
  if (!pid) {
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
  }, 5_000).unref()
}

async function run() {
  if (process.platform !== 'darwin') {
    throw new Error('This AppKit reproduction requires macOS')
  }
  seedProfile()
  const cdpPort = await freePort()
  const stdoutPath = path.join(evidenceDir, 'orca.stdout.log')
  const stderrPath = path.join(evidenceDir, 'orca.stderr.log')
  const app = spawn(electronPath, [`--remote-debugging-port=${cdpPort}`, mainEntry], {
    cwd: projectDir,
    detached: true,
    env: isolatedLaunchEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  app.stdout.on('data', (chunk) => appendFileSync(stdoutPath, chunk))
  app.stderr.on('data', (chunk) => appendFileSync(stderrPath, chunk))
  app.on('exit', (code, signal) => log('orca_exit', { code, signal }))
  log('orca_launched', {
    pid: app.pid,
    cdpPort,
    durationMinutes,
    activationIntervalMs,
    macos: os.release(),
    arch: os.arch()
  })

  let mobile
  let reproduced = false
  let failure = null
  try {
    await waitForCdp(cdpPort)
    await agentBrowser(['connect', String(cdpPort)])
    await takeWindowEvidence('t1', 'main-before-popout')
    const setupOutput = await rendererEval(`(async () => {
      await window.api.settings.set({ experimentalAgentDashboardPopout: true });
      await window.api.dashboard.openPopout('board');
      const pairing = await window.api.mobile.getPairingQR({ connectionMode: 'local-only' });
      if (!pairing?.available || !pairing.pairingUrl) throw new Error(JSON.stringify(pairing));
      return 'PAIRING:' + pairing.pairingUrl;
    })()`)
    const pairingUrl = setupOutput.match(/PAIRING:(orca:\/\/pair\?code=[A-Za-z0-9_-]+)/)?.[1]
    if (!pairingUrl) {
      throw new Error(`Could not read pairing URL from agent-browser output: ${setupOutput}`)
    }
    const tabs = await waitForPopoutTab()
    writeFileSync(path.join(evidenceDir, 'tabs.txt'), tabs.tabList)
    await takeWindowEvidence(tabs.popoutId, 'dashboard-popout')
    await takeWindowEvidence(tabs.mainId, 'main-with-popout')

    mobile = new MobileHomeSession(pairingUrl, log)
    await mobile.connect()
    await mobile.startHomeTraffic()
    log('faithful_topology_ready', {
      mainTab: tabs.mainId,
      popoutTab: tabs.popoutId,
      mobileScreen: 'home'
    })

    const deadline = Date.now() + durationMinutes * 60_000
    let activation = 0
    while (Date.now() < deadline) {
      if (app.exitCode !== null) {
        throw new Error(`Orca exited before the reproduction completed (${app.exitCode})`)
      }
      const activeTab = activation % 2 === 0 ? tabs.popoutId : tabs.mainId
      await agentBrowser(['tab', activeTab], { timeoutMs: 10_000 })
      activation++
      if (activeTab === tabs.mainId) {
        const liveness = await rendererEval(
          `(async () => {
          let timer;
          const result = await Promise.race([
            window.api.settings.get().then(() => 'MAIN_IPC_ALIVE'),
            new Promise((resolve) => { timer = setTimeout(() => resolve('MAIN_IPC_TIMEOUT'), 5000) })
          ]);
          clearTimeout(timer);
          return result;
        })()`,
          10_000
        )
        if (liveness.includes('MAIN_IPC_TIMEOUT')) {
          reproduced = true
          log('main_thread_hang_reproduced', { activation })
          await captureMainSample(app.pid, 'renderer-to-main IPC timed out')
          break
        }
      }
      if (activation % 40 === 0) {
        await takeWindowEvidence(activeTab, `checkpoint-${String(activation).padStart(4, '0')}`)
      }
      await new Promise((resolve) => setTimeout(resolve, activationIntervalMs))
    }
  } catch (error) {
    failure = String(error)
    log('repro_harness_error', { error: failure })
    if (app.pid && app.exitCode === null) {
      await captureMainSample(app.pid, failure)
    }
  } finally {
    mobile?.close()
    terminateProcessGroup(app.pid)
    const result = {
      reproduced,
      failure,
      durationMinutes,
      activationIntervalMs,
      pid: app.pid,
      runRoot,
      evidenceDir
    }
    writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
    log('repro_finished', result)
  }
  if (failure) {
    process.exitCode = 1
  } else if (reproduced) {
    process.exitCode = 86
  }
}

await run()
