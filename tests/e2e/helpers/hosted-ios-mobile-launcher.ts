import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { openHostedIosHybridRoute } from '../../../mobile/scripts/hosted-ios-hybrid-route-handoff.mjs'
import {
  runHostedIosEmulatorCommand,
  type HostedIosEmulatorCommandOptions
} from './hosted-ios-emulator-command'

export {
  runHostedIosEmulatorCommand,
  type HostedIosEmulatorCommandOptions
} from './hosted-ios-emulator-command'

const execFileAsync = promisify(execFile)

type HostedIosMobileLauncherOptions = {
  deviceUdid: string
  hostPublicKey: string
  orcaCli: string
  userDataDir: string
  worktree: string
}

type AccessibilityNode = {
  children?: AccessibilityNode[]
  enabled?: boolean
  frame?: { height?: number; width?: number; x?: number; y?: number }
  label?: string
  value?: string
}

export async function resolveHostedIosSimulatorUdid(requested: string): Promise<string> {
  const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])
  const devices = Object.values(
    (
      JSON.parse(stdout) as {
        devices?: Record<string, { name?: string; state?: string; udid?: string }[]>
      }
    ).devices ?? {}
  ).flat()
  const matches = devices.filter((device) => device.udid === requested || device.name === requested)
  const selected = matches.find((device) => device.state === 'Booted') ?? matches[0]
  if (!selected?.udid) {
    throw new Error(`No available iOS Simulator matched "${requested}".`)
  }
  return selected.udid
}

export function startHostedIosMobileLauncher({
  deviceUdid,
  hostPublicKey,
  orcaCli,
  userDataDir,
  worktree
}: HostedIosMobileLauncherOptions): ChildProcess {
  const runDirectory = hostedIosRunDirectory(worktree)
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 })
  return spawn(
    process.execPath,
    [
      path.join(worktree, 'mobile', 'scripts', 'start-emulator.mjs'),
      '--worktree',
      worktree,
      '--device',
      deviceUdid,
      '--no-pair',
      '--wait-for-ready'
    ],
    {
      cwd: worktree,
      env: {
        ...process.env,
        EXPO_PUBLIC_ORCA_E2E_MOBILE_WEB_HOST_PUBLIC_KEY: hostPublicKey,
        ORCA_CLI: orcaCli,
        ORCA_DEV_USER_DATA_PATH: userDataDir,
        ORCA_E2E_MOBILE_RUN_DIRECTORY: runDirectory,
        ORCA_USER_DATA_PATH: userDataDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
}

export function waitForHostedIosMobileLauncher(
  child: ChildProcess,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let outputTail = ''
    let settled = false
    const timer = setTimeout(
      () => finish(new Error(`Mobile launcher timed out.\n${outputTail}`)),
      timeoutMs
    )
    const consume = (chunk: Buffer, target: NodeJS.WriteStream) => {
      const text = String(chunk)
      target.write(text)
      outputTail = (outputTail + text).slice(-32 * 1024)
      if (outputTail.includes('Setup complete!')) {
        finish()
      }
    }
    const finish = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.off('exit', handleExit)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const handleExit = (code: number | null) => {
      finish(new Error(`Mobile launcher exited with code ${code}.\n${outputTail}`))
    }
    child.stdout?.on('data', (chunk: Buffer) => consume(chunk, process.stdout))
    child.stderr?.on('data', (chunk: Buffer) => consume(chunk, process.stderr))
    child.once('error', finish)
    child.once('exit', handleExit)
  })
}

export async function pairAndOpenHostedIosRoute(args: {
  deviceUdid: string
  orcaCli: string
  pairingUrl: string
  userDataDir: string
  worktree: string
}): Promise<void> {
  const { deviceUdid, pairingUrl } = args
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await execFileAsync('xcrun', ['simctl', 'openurl', deviceUdid, pairingUrl])
    await delay(2_000)
  }
  const pairControl = await waitForHostedIosAccessibilityControl(args, 'Pair', 20_000)
  await runHostedIosEmulatorCommand(args, ['tap', String(pairControl.x), String(pairControl.y)])
  await waitForPairingCompletion(args, 45_000)
  await openHostedIosHybridRoute(args, 45_000)
}

export async function sendHostedIosBufferedCommand(
  args: HostedIosEmulatorCommandOptions,
  command: string
): Promise<void> {
  const modeControl = await waitForHostedIosAccessibilityControl(
    args,
    'Switch to buffered command input',
    20_000
  )
  await runHostedIosEmulatorCommand(args, ['tap', String(modeControl.x), String(modeControl.y)])
  const inputControl = await waitForHostedIosAccessibilityControl(args, 'Type a command…', 20_000)
  await runHostedIosEmulatorCommand(args, ['tap', String(inputControl.x), String(inputControl.y)])
  await delay(250)
  await runHostedIosEmulatorCommand(args, ['type', command])
  const sendControl = await waitForHostedIosAccessibilityControl(args, 'Send command', 20_000)
  await runHostedIosEmulatorCommand(args, ['tap', String(sendControl.x), String(sendControl.y)])
}

export async function stopHostedIosMobileLauncher(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) {
    return
  }
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    })
  ])
}

function hostedIosRunDirectory(worktree: string): string {
  const key = createHash('sha256').update(worktree).digest('hex').slice(0, 16)
  return path.join('/tmp', `orca-mobile-webview-ssh-e2e-${key}`)
}

export async function waitForHostedIosAccessibilityControl(
  args: HostedIosEmulatorCommandOptions,
  label: string,
  timeoutMs: number
): Promise<{ x: number; y: number }> {
  const deadline = Date.now() + timeoutMs
  let lastLabels: string[] = []
  while (Date.now() < deadline) {
    const nodes = await readAccessibilityNodes(args)
    lastLabels = accessibilityLabels(nodes)
    const control = nodes.find((node) => {
      const matches = node.label === label || node.value === label
      return matches && node.enabled !== false && node.frame && isFiniteFrame(node.frame)
    })
    if (control?.frame) {
      return {
        x: control.frame.x! + control.frame.width! / 2,
        y: control.frame.y! + control.frame.height! / 2
      }
    }
    await delay(250)
  }
  throw new Error(`${label} was not accessible. Last labels: ${summarizeLabels(lastLabels)}`)
}

async function waitForPairingCompletion(
  args: Parameters<typeof pairAndOpenHostedIosRoute>[0],
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastLabels: string[] = []
  while (Date.now() < deadline) {
    const first = await readAccessibilityNodes(args)
    lastLabels = accessibilityLabels(first)
    const error = lastLabels.find(
      (label) =>
        label.includes('Pairing failed') ||
        label.includes("Couldn't connect") ||
        label.includes('Invalid pairing')
    )
    if (error) {
      throw new Error(`Mobile pairing failed: ${error}`)
    }
    if (!hasPairingStage(lastLabels)) {
      await delay(500)
      const confirmationLabels = accessibilityLabels(await readAccessibilityNodes(args))
      if (!hasPairingStage(confirmationLabels)) {
        return
      }
      lastLabels = confirmationLabels
    }
    await delay(250)
  }
  throw new Error(`Mobile pairing did not complete. Last labels: ${summarizeLabels(lastLabels)}`)
}

async function readAccessibilityNodes(
  args: Parameters<typeof pairAndOpenHostedIosRoute>[0]
): Promise<AccessibilityNode[]> {
  const { stdout } = await runHostedIosEmulatorCommand(args, ['ax'])
  const response = JSON.parse(stdout) as { ok?: unknown; result?: unknown }
  if (response.ok !== true || !Array.isArray(response.result)) {
    throw new Error('Orca emulator returned an invalid accessibility response')
  }
  return flattenAccessibilityNodes(response.result.filter(isAccessibilityNode))
}

function flattenAccessibilityNodes(roots: AccessibilityNode[]): AccessibilityNode[] {
  const result: AccessibilityNode[] = []
  const pending = [...roots]
  while (pending.length > 0 && result.length < 2_000) {
    const node = pending.shift()!
    result.push(node)
    if (Array.isArray(node.children)) {
      pending.push(...node.children.filter(isAccessibilityNode))
    }
  }
  return result
}

function isAccessibilityNode(value: unknown): value is AccessibilityNode {
  return Boolean(value && typeof value === 'object')
}

function isFiniteFrame(
  frame: NonNullable<AccessibilityNode['frame']>
): frame is { height: number; width: number; x: number; y: number } {
  return [frame.x, frame.y, frame.width, frame.height].every(
    (value) => typeof value === 'number' && Number.isFinite(value)
  )
}

function accessibilityLabels(nodes: AccessibilityNode[]): string[] {
  return nodes.flatMap((node) =>
    [node.label, node.value].filter((value): value is string => Boolean(value))
  )
}

function hasPairingStage(labels: string[]): boolean {
  return labels.some(
    (label) => label === 'Pair' || label === 'Pair with this desktop?' || label === 'Connecting…'
  )
}

function summarizeLabels(labels: string[]): string {
  return JSON.stringify(labels.slice(0, 40))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
