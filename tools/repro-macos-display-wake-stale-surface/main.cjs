#!/usr/bin/env node

const { execFile } = require('node:child_process')
const { createHash } = require('node:crypto')
const { promisify } = require('node:util')
const { app, BrowserWindow, desktopCapturer, powerMonitor, screen } = require('electron')

const execFileAsync = promisify(execFile)
const argv = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=')
    return [key, value.join('=') || 'true']
  })
)
const trigger = argv.get('trigger') ?? 'lock-screen'
const cycles = parsePositiveInteger('cycles', trigger === 'lock-screen' ? 1 : 20)
const displayOffMs = parsePositiveInteger('display-off-ms', 5_000)
const wakeSettleMs = parsePositiveInteger('wake-settle-ms', 1_500)
const unlockTimeoutMs = parsePositiveInteger('unlock-timeout-ms', 43_200_000)
const lockHoldMs = parseNonnegativeInteger('lock-hold-ms', 0)
const webglContexts = parseNonnegativeInteger('webgl-contexts', 15)
const repaintMode = argv.get('repaint') ?? 'device-emulation'
const allowedRepaintModes = new Set(['device-emulation', 'frame-jiggle', 'invalidate'])
const allowedTriggers = new Set(['display-sleep', 'lock-screen'])

if (process.platform !== 'darwin') {
  fail('This reproduction requires macOS.')
}
if (!allowedRepaintModes.has(repaintMode)) {
  fail(`--repaint must be one of: ${Array.from(allowedRepaintModes).join(', ')}`)
}
if (!allowedTriggers.has(trigger)) {
  fail(`--trigger must be one of: ${Array.from(allowedTriggers).join(', ')}`)
}

let window = null
let displayWakeTimer = null

function fail(message) {
  console.error(message)
  process.exit(2)
}

function parsePositiveInteger(name, fallback) {
  const raw = argv.get(name)
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(`--${name} must be a positive integer`)
  }
  return parsed
}

function parseNonnegativeInteger(name, fallback) {
  const raw = argv.get(name)
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`--${name} must be a nonnegative integer`)
  }
  return parsed
}

function log(event, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      at: new Date().toISOString(),
      event,
      repaintMode,
      trigger,
      webglContexts,
      ...details
    })}\n`
  )
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function hashPng(image) {
  return createHash('sha256').update(image.toPNG()).digest('hex')
}

async function captureRendererSurface() {
  if (!window || window.isDestroyed()) {
    throw new Error('window unavailable')
  }
  return hashPng(await window.webContents.capturePage())
}

async function captureWindowServerSurface() {
  if (!window || window.isDestroyed()) {
    throw new Error('window unavailable')
  }
  const [width, height] = window.getSize()
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  const source = sources.find((candidate) => candidate.name === window.getTitle())
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(
      `WindowServer surface unavailable; screen recording permission may be missing (${sources
        .map((candidate) => candidate.name)
        .join(', ')})`
    )
  }
  return hashPng(source.thumbnail)
}

async function setFrame(frame) {
  if (!window || window.isDestroyed()) {
    throw new Error('window unavailable')
  }
  await window.webContents.executeJavaScript(`window.setHarnessFrame(${frame})`)
}

async function readFrame() {
  if (!window || window.isDestroyed()) {
    throw new Error('window unavailable')
  }
  return window.webContents.executeJavaScript('window.harnessFrame')
}

async function readVisibility() {
  if (!window || window.isDestroyed()) {
    throw new Error('window unavailable')
  }
  return window.webContents.executeJavaScript(`({
    state: document.visibilityState,
    events: window.harnessVisibilityEvents.slice(),
    webgl: window.harnessWebglState
  })`)
}

function forceRepaint() {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }
  window.webContents.invalidate()
  if (repaintMode === 'invalidate') {
    return
  }
  if (repaintMode === 'frame-jiggle') {
    const [width, height] = window.getSize()
    setTimeout(() => {
      if (!window || window.isDestroyed()) {
        return
      }
      window.setSize(width + 1, height)
      setTimeout(() => {
        if (window && !window.isDestroyed()) {
          window.setSize(width, height)
        }
      }, 32)
    }, 0)
    return
  }

  const [width, height] = window.getContentSize()
  const display = screen.getDisplayMatching(window.getBounds())
  window.webContents.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: 0, height: 0 },
    deviceScaleFactor: (display.scaleFactor || 1) + 0.25,
    viewSize: { width, height },
    scale: 1
  })
  setTimeout(() => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.disableDeviceEmulation()
    }
  }, 32)
}

async function turnDisplayOffAndWake() {
  const wakeDisplay = () => {
    execFile('/usr/bin/caffeinate', ['-u', '-t', '2'], (error) => {
      if (error) {
        log('display-wake-failed', { message: error.message })
      }
    })
  }
  displayWakeTimer = setTimeout(wakeDisplay, displayOffMs)
  await execFileAsync('/usr/bin/pmset', ['displaysleepnow'])
  await delay(displayOffMs + wakeSettleMs)
  forceRepaint()
  await delay(wakeSettleMs)
  if (displayWakeTimer) {
    clearTimeout(displayWakeTimer)
    displayWakeTimer = null
  }
  return readVisibility()
}

async function lockAndUnlockScreen() {
  const transition = {
    lockedAt: null,
    unlockedAt: null
  }
  const completed = new Promise((resolve, reject) => {
    let locked = false
    const lockTimeout = setTimeout(() => {
      cleanup()
      reject(new Error('screen was not locked within two minutes'))
    }, 120_000)
    const unlockTimeout = setTimeout(() => {
      cleanup()
      reject(new Error(`screen was not unlocked within ${unlockTimeoutMs}ms`))
    }, unlockTimeoutMs)
    const onLock = () => {
      locked = true
      transition.lockedAt = new Date().toISOString()
      log('screen-locked', { ...transition, minimumHoldMs: lockHoldMs })
      clearTimeout(lockTimeout)
      if (lockHoldMs > 0) {
        execFile('/usr/bin/pmset', ['displaysleepnow'], (error) => {
          if (error) {
            log('lock-hold-display-off-failed', { message: error.message })
          }
        })
        setTimeout(() => {
          execFile('/usr/bin/caffeinate', ['-u', '-t', '10'], (error) => {
            if (error) {
              log('lock-hold-wake-failed', { message: error.message })
            }
          })
          log('lock-hold-complete', { minimumHoldMs: lockHoldMs })
        }, lockHoldMs)
      }
    }
    const onUnlock = () => {
      if (!locked) {
        return
      }
      const heldMs = Date.now() - Date.parse(transition.lockedAt)
      if (heldMs < lockHoldMs) {
        cleanup()
        reject(new Error(`screen unlocked after ${heldMs}ms; required ${lockHoldMs}ms`))
        return
      }
      transition.unlockedAt = new Date().toISOString()
      cleanup()
      resolve()
    }
    function cleanup() {
      clearTimeout(lockTimeout)
      clearTimeout(unlockTimeout)
      powerMonitor.removeListener('lock-screen', onLock)
      powerMonitor.removeListener('unlock-screen', onUnlock)
    }
    powerMonitor.on('lock-screen', onLock)
    powerMonitor.on('unlock-screen', onUnlock)
  })
  log('awaiting-lock-shortcut', {
    instruction:
      lockHoldMs > 0
        ? `Press Control+Command+Q; wait ${lockHoldMs}ms before unlocking.`
        : 'Press Control+Command+Q, then unlock with Touch ID or password.'
  })
  await completed
  log('screen-unlocked', transition)
  await delay(wakeSettleMs)
  forceRepaint()
  await delay(wakeSettleMs)
  return { ...transition, visibility: await readVisibility() }
}

async function sampleSurfaces() {
  const frame = await readFrame()
  const visibility = await readVisibility()
  // Why: capturePage can request compositor work; sample WindowServer before it can heal the surface.
  const windowServerHash = await captureWindowServerSurface()
  const rendererHash = await captureRendererSurface()
  return { frame, visibility, rendererHash, windowServerHash }
}

async function runCycle(cycle, previous) {
  const displayTransition =
    trigger === 'lock-screen' ? await lockAndUnlockScreen() : await turnDisplayOffAndWake()
  await setFrame(cycle)
  await delay(500)
  const current = await sampleSurfaces()
  const rendererAdvanced = current.frame === cycle && current.rendererHash !== previous.rendererHash
  const windowServerAdvanced = current.windowServerHash !== previous.windowServerHash
  log('cycle', {
    cycle,
    frame: current.frame,
    displayTransition,
    visibility: current.visibility,
    rendererAdvanced,
    windowServerAdvanced,
    rendererHash: current.rendererHash,
    windowServerHash: current.windowServerHash
  })
  return {
    current,
    stalePresentation: rendererAdvanced && !windowServerAdvanced
  }
}

async function run() {
  window = new BrowserWindow({
    width: 960,
    height: 640,
    title: `Orca stale-surface repro ${process.pid}`,
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      backgroundThrottling: true,
      contextIsolation: true,
      sandbox: true
    }
  })
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, monospace; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { display: grid; place-items: center; background: #0a0a0a; color: #fafafa; }
      main { text-align: center; }
      #frame { font-size: 180px; font-weight: 700; line-height: 1; }
      #stamp { margin-top: 32px; font-size: 24px; }
      #webgl { position: fixed; inset: 0; display: grid; grid-template-columns: repeat(5, 1fr);
        pointer-events: none; opacity: 0.08; }
      canvas { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <main>
      <div id="frame">0</div>
      <div id="stamp">baseline</div>
    </main>
    <div id="webgl"></div>
    <script>
      window.harnessFrame = 0
      window.harnessVisibilityEvents = []
      window.harnessWebglState = { requested: ${webglContexts}, active: 0, resets: 0, losses: 0 }
      const webglSurfaces = []
      const webglRoot = document.querySelector('#webgl')
      for (let index = 0; index < ${webglContexts}; index += 1) {
        const canvas = document.createElement('canvas')
        canvas.width = 1024
        canvas.height = 1024
        canvas.addEventListener('webglcontextlost', (event) => {
          event.preventDefault()
          window.harnessWebglState.losses += 1
        })
        webglRoot.append(canvas)
        const gl = canvas.getContext('webgl2', { antialias: false, depth: false })
        if (gl) {
          webglSurfaces.push({ gl, texture: null })
          window.harnessWebglState.active += 1
        }
      }
      function resetWebglSurfaces(frame) {
        for (const surface of webglSurfaces) {
          const { gl } = surface
          if (surface.texture) {
            gl.deleteTexture(surface.texture)
          }
          surface.texture = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, surface.texture)
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1024,
            1024,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null
          )
          gl.clearColor((frame % 7) / 7, ((frame + 2) % 7) / 7, ((frame + 4) % 7) / 7, 1)
          gl.clear(gl.COLOR_BUFFER_BIT)
        }
        window.harnessWebglState.resets += 1
      }
      resetWebglSurfaces(0)
      document.addEventListener('visibilitychange', () => {
        window.harnessVisibilityEvents.push({
          at: new Date().toISOString(),
          state: document.visibilityState
        })
        if (document.visibilityState === 'visible') {
          resetWebglSurfaces(window.harnessFrame)
        }
      })
      window.setHarnessFrame = (frame) => {
        window.harnessFrame = frame
        document.querySelector('#frame').textContent = String(frame)
        document.querySelector('#stamp').textContent = new Date().toISOString()
        document.body.style.background = frame % 2 === 0 ? '#0a0a0a' : '#172554'
        resetWebglSurfaces(frame)
      }
    </script>
  </body>
</html>
`)}`
  )
  app.focus({ steal: true })
  window.setAlwaysOnTop(true, 'floating')
  window.show()
  window.focus()
  window.moveTop()
  await delay(250)
  window.setAlwaysOnTop(false)
  await delay(1_000)

  let previous = await sampleSurfaces()
  log('baseline', previous)
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const result = await runCycle(cycle, previous)
    if (result.stalePresentation) {
      log('reproduced', {
        cycle,
        rendererFrame: result.current.frame,
        rendererHash: result.current.rendererHash,
        staleWindowServerHash: result.current.windowServerHash
      })
      app.exit(1)
      return
    }
    previous = result.current
  }
  log('not-reproduced', { cycles })
  app.exit(0)
}

app.on('window-all-closed', () => app.exit(0))
app
  .whenReady()
  .then(run)
  .catch((error) => {
    log('error', {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    app.exit(2)
  })
