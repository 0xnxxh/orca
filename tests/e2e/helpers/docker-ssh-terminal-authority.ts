import {
  parseSshTerminalAuthorityMarker,
  type SshTerminalAuthorityMarker
} from '../../../src/shared/ssh-terminal-authority-marker'
import type { SshRemotePtyLease } from '../../../src/shared/ssh-types'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  execDockerSshRelayTargetCommand,
  shellQuote,
  type DockerSshRelayTarget
} from './docker-ssh-relay-target'
import { readDockerSshRelayDaemonLogs } from './docker-ssh-relay-processes'

export const DOCKER_SSH_TERMINAL_AUTHORITY_STATE_DIR = '/root/.orca-remote/terminal-authority'
export const DOCKER_SSH_TERMINAL_AUTHORITY_MARKER_PATH = `${DOCKER_SSH_TERMINAL_AUTHORITY_STATE_DIR}/active-endpoint`
export const DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT = '/tmp/orca-terminal-authority-audit.js'
export const DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE = '/tmp/orca-terminal-authority-input.log'
export const DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_COMPLETE =
  '/tmp/orca-terminal-authority-replay.complete'
export const DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT = 32

export const DOCKER_SSH_INCOMPATIBLE_AUTHORITY_REVISION = 7

export function dockerSshTerminalAuthorityInputFrame(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error('Docker SSH authority input frame cannot contain a newline')
  }
  return `${value}\n`
}

export async function installDockerSshTerminalBindingTransitionProbe(
  page: Page,
  args: { targetId: string; tabId: string; leafId: string }
): Promise<void> {
  await page.evaluate(({ targetId, tabId, leafId }) => {
    const holder = window as unknown as {
      __sshAuthorityBindingProbe?: { entries: unknown[]; dispose: () => void }
    }
    holder.__sshAuthorityBindingProbe?.dispose()
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const entries: unknown[] = []
    let lastSignature = ''
    const capture = (): void => {
      const state = store.getState()
      const connection = state.sshConnectionStates.get(targetId)
      const tab = Object.values(state.tabsByWorktree)
        .flat()
        .find((candidate) => candidate.id === tabId)
      const retry = state.directSshPaneRetryByTabId[tabId]
      const live = state.directSshLivePtyBindingByTabId[tabId]
      const transition = {
        connection: connection
          ? {
              status: connection.status,
              providerEpoch: connection.providerEpoch ?? null,
              connectionGeneration: connection.connectionGeneration ?? null
            }
          : null,
        tab: tab
          ? {
              generation: tab.generation ?? 0,
              ptyId: tab.ptyId ?? null,
              pendingActivationSpawn: Boolean(tab.pendingActivationSpawn)
            }
          : null,
        layoutPtyId: state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId[leafId] ?? null,
        tabPtyIds: state.ptyIdsByTabId[tabId] ?? [],
        retry: retry ?? null,
        live: live ?? null
      }
      const signature = JSON.stringify(transition)
      if (signature === lastSignature) {
        return
      }
      lastSignature = signature
      entries.push({ at: Date.now(), ...transition })
      if (entries.length > 128) {
        entries.shift()
      }
    }
    capture()
    const dispose = store.subscribe(capture)
    holder.__sshAuthorityBindingProbe = { entries, dispose }
  }, args)
}

export function dockerSshTerminalAuthorityAuditProgram(): string {
  return [
    "const fs = require('node:fs')",
    `const audit = ${JSON.stringify(DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE)}`,
    `const complete = ${JSON.stringify(DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_COMPLETE)}`,
    "const append = (line) => fs.appendFileSync(audit, line + '\\n')",
    "process.stdin.setEncoding('utf8')",
    'if (process.stdin.isTTY) process.stdin.setRawMode(true)',
    'process.stdin.resume()',
    "let pendingInput = ''",
    "append('START:' + process.pid)",
    "process.stdout.write('AUTHORITY_AUDIT_READY\\r\\n')",
    "process.stdin.on('data', (data) => {",
    '  pendingInput += data',
    '  const frames = pendingInput.split(/[\\r\\n]/)',
    "  pendingInput = frames.pop() || ''",
    '  for (const frame of frames) {',
    '    if (!frame) continue',
    "    const encoded = Buffer.from(frame).toString('base64url')",
    "    append('INPUT:' + encoded)",
    "    process.stdout.write('AUTHORITY_INPUT_ACK_' + encoded + '\\r\\n')",
    '  }',
    '})',
    "process.on('SIGHUP', () => append('SIGHUP'))",
    "process.on('SIGUSR2', () => {",
    `  for (let index = 1; index <= ${DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT}; index += 1) {`,
    "    process.stdout.write('AUTHORITY_REPLAY_' + String(index).padStart(2, '0') + '\\r\\n')",
    '  }',
    "  fs.writeFileSync(complete, 'complete\\n')",
    '})'
  ].join('\n')
}

export async function attachDockerSshTerminalAuthorityLogs(
  testInfo: TestInfo,
  target: DockerSshRelayTarget | null
): Promise<void> {
  if (!target) {
    return
  }
  try {
    const logPath = testInfo.outputPath('docker-ssh-relay-logs.txt')
    writeFileSync(logPath, readDockerSshRelayDaemonLogs(target))
    await testInfo.attach('docker-ssh-relay-logs', {
      path: logPath,
      contentType: 'text/plain'
    })
  } catch {
    // Container cleanup still owns the failure path.
  }
}

export function readPersistedDockerSshTerminalAuthorityLease(
  userDataDir: string,
  targetId: string
): SshRemotePtyLease | null {
  const index = readJsonFile(path.join(userDataDir, 'orca-profile-index.json'))
  const activeProfileId =
    isRecord(index) && typeof index.activeProfileId === 'string' ? index.activeProfileId : null
  const candidates = [
    ...(activeProfileId
      ? [path.join(userDataDir, 'profiles', activeProfileId, 'orca-data.json')]
      : []),
    path.join(userDataDir, 'orca-data.json')
  ]
  for (const dataFile of candidates) {
    const persisted = readJsonFile(dataFile)
    if (!isRecord(persisted) || !Array.isArray(persisted.sshRemotePtyLeases)) {
      continue
    }
    const leases = persisted.sshRemotePtyLeases.filter(isSshRemotePtyLease)
    const matches = leases.filter(
      (lease) =>
        lease.targetId === targetId &&
        lease.state !== 'terminated' &&
        lease.terminalSessionAuthorityAccess !== undefined
    )
    return matches.length === 1 ? matches[0]! : null
  }
  return null
}

export function readDockerSshTerminalAuthorityAuditPid(target: DockerSshRelayTarget): number {
  const audit = readDockerSshAuditFile(target, DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE)
  const starts = [...audit.matchAll(/^START:(\d+)$/gm)].map((match) => Number(match[1]))
  if (starts.length !== 1 || !Number.isSafeInteger(starts[0]) || starts[0]! <= 0) {
    throw new Error(`Expected one live Docker SSH authority audit process, found: ${audit}`)
  }
  const pid = starts[0]!
  execDockerSshRelayTargetCommand(target, `test -r /proc/${pid}/cmdline`)
  return pid
}

export function readDockerSshTerminalAuthorityMarker(
  target: DockerSshRelayTarget
): SshTerminalAuthorityMarker | null {
  const output = execDockerSshRelayTargetCommand(
    target,
    `if [ -f ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_MARKER_PATH)} ]; then ` +
      `cat ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_MARKER_PATH)}; fi`
  )
  if (!output) {
    return null
  }
  const marker = parseSshTerminalAuthorityMarker(JSON.parse(output))
  if (!marker) {
    throw new Error('Docker SSH terminal authority marker is invalid')
  }
  return marker
}

export function installDockerSshIncompatibleTerminalAuthorityMarker(
  target: DockerSshRelayTarget
): void {
  const ownerRelayDir = '/root/.orca-remote/relay-0.0.0+deadbeef'
  const marker: SshTerminalAuthorityMarker = {
    markerVersion: 1,
    authorityHostId: '10000000-0000-4000-8000-000000000001',
    ownerInstanceId: '20000000-0000-4000-8000-000000000002',
    ownerPid: 1,
    ownerProcessToken: 'incompatible_owner_token_1234',
    ownerBuildId: 'incompatible-owner-build',
    ownerRelayDir,
    socketPath: `${DOCKER_SSH_TERMINAL_AUTHORITY_STATE_DIR}/authority.sock`,
    credentialFile: `${DOCKER_SSH_TERMINAL_AUTHORITY_STATE_DIR}/endpoint.credential`,
    compatibility: {
      major: 999,
      minMinor: 0,
      maxMinor: 0,
      capabilities: ['relay.rpc.v1'],
      requiredCapabilities: ['relay.rpc.v1']
    },
    revision: DOCKER_SSH_INCOMPATIBLE_AUTHORITY_REVISION
  }
  execDockerSshRelayTargetCommand(
    target,
    [
      `mkdir -p ${shellQuote(ownerRelayDir)} ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_STATE_DIR)}`,
      `chmod 700 ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_STATE_DIR)}`,
      `printf '%s' ${shellQuote('incompatible-credential')} > ${shellQuote(marker.credentialFile)}`,
      `chmod 600 ${shellQuote(marker.credentialFile)}`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(marker))} > ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_MARKER_PATH)}`,
      `chmod 600 ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_MARKER_PATH)}`
    ].join(' && ')
  )
}

export function countDockerSshPtyChildren(
  target: DockerSshRelayTarget,
  authorityPid: number
): number {
  if (!Number.isInteger(authorityPid)) {
    throw new Error('Terminal authority PID must be an integer')
  }
  const output = execDockerSshRelayTargetCommand(
    target,
    [
      `root=${authorityPid}`,
      'count=0',
      'frontier="$root"',
      'while [ -n "$frontier" ]; do',
      '  next=',
      '  for parent in $frontier; do',
      '    for proc in /proc/[0-9]*; do',
      '      [ -r "$proc/status" ] || continue',
      '      pid="${proc##*/}"',
      '      ppid="$(awk \'/^PPid:/{print $2}\' "$proc/status" 2>/dev/null)"',
      '      if [ "$ppid" = "$parent" ]; then count=$((count+1)); next="$next $pid"; fi',
      '    done',
      '  done',
      '  frontier="$next"',
      'done',
      'printf "%s" "$count"'
    ].join('\n')
  )
  const count = Number(output)
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid Docker SSH PTY child count: ${output}`)
  }
  return count
}

export function readDockerSshAuditFile(target: DockerSshRelayTarget, path: string): string {
  return execDockerSshRelayTargetCommand(
    target,
    `if [ -f ${shellQuote(path)} ]; then cat ${shellQuote(path)}; fi`
  )
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function isSshRemotePtyLease(value: unknown): value is SshRemotePtyLease {
  if (!isRecord(value)) {
    return false
  }
  const state = value.state
  return (
    typeof value.targetId === 'string' &&
    typeof value.ptyId === 'string' &&
    (state === 'attached' || state === 'detached' || state === 'terminated' || state === 'expired')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
