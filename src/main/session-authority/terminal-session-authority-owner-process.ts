import { readFile } from 'node:fs/promises'
import { parseLinuxStartTicks } from '../agent-hooks/managed-hook-owner-identity'
import {
  inspectProcessSignal,
  queryWindowsProcess,
  readLinuxStat,
  readMacosProcessStartedAtMs
} from '../daemon/daemon-process-inspection'
import {
  readCurrentTerminalAuthorityExecutionScope,
  readTerminalAuthorityLinuxPidNamespace
} from './terminal-session-authority-host-identity'

export type TerminalAuthorityOwnerProcessIdentity = Readonly<{
  pid: number
  platform: NodeJS.Platform | 'legacy'
  startedAtMs?: number
  linuxStartTicks?: string
  linuxPidNamespace?: string
  bootId?: string
  executionScope?: string
}>

export type TerminalAuthorityOwnerProcessObservation =
  | Readonly<{
      status: 'missing' | 'unknown'
      platform?: NodeJS.Platform
      bootId?: string
      linuxPidNamespace?: string
      executionScope?: string
    }>
  | Readonly<{
      status: 'present'
      platform: NodeJS.Platform
      startedAtMs?: number
      linuxStartTicks?: string
      linuxPidNamespace?: string
      bootId?: string
      executionScope?: string
    }>

export async function readCurrentTerminalAuthorityOwnerProcessIdentity(): Promise<TerminalAuthorityOwnerProcessIdentity> {
  if (process.platform === 'linux') {
    return readCurrentLinuxIdentity()
  }
  if (process.platform === 'darwin') {
    const [startedAtMs, scope] = await Promise.all([
      readMacosProcessStartedAtMs(process.pid),
      readCurrentTerminalAuthorityExecutionScope()
    ])
    return Object.freeze({
      pid: process.pid,
      platform: process.platform,
      ...scope,
      ...(startedAtMs === null ? {} : { startedAtMs })
    })
  }
  if (process.platform === 'win32') {
    const [processIdentity, scope] = await Promise.all([
      queryWindowsProcess(process.pid),
      readCurrentTerminalAuthorityExecutionScope()
    ])
    return Object.freeze({
      pid: process.pid,
      platform: process.platform,
      ...scope,
      ...(processIdentity.status === 'present' && processIdentity.startedAtMs !== null
        ? { startedAtMs: processIdentity.startedAtMs }
        : {})
    })
  }
  const scope = await readCurrentTerminalAuthorityExecutionScope()
  return Object.freeze({
    pid: process.pid,
    platform: process.platform,
    ...scope
  })
}

export async function terminalAuthorityOwnerProcessIsGone(
  identity: TerminalAuthorityOwnerProcessIdentity
): Promise<boolean> {
  return terminalAuthorityOwnerProcessObservationProvesGone(
    identity,
    await inspectTerminalAuthorityOwnerProcess(identity.pid)
  )
}

export function terminalAuthorityOwnerProcessObservationProvesGone(
  identity: TerminalAuthorityOwnerProcessIdentity,
  observation: TerminalAuthorityOwnerProcessObservation
): boolean {
  if (
    !identity.executionScope ||
    !observation.executionScope ||
    identity.executionScope !== observation.executionScope
  ) {
    return false
  }
  if (identity.platform === 'legacy' || identity.platform !== observation.platform) {
    return false
  }
  if (identity.platform === 'linux') {
    if (
      !identity.linuxStartTicks ||
      !identity.linuxPidNamespace ||
      !identity.bootId ||
      observation.linuxPidNamespace !== identity.linuxPidNamespace
    ) {
      return false
    }
    if (observation.status === 'missing') {
      return true
    }
    if (observation.status !== 'present') {
      return false
    }
    return (
      observation.bootId !== undefined &&
      observation.linuxStartTicks !== undefined &&
      (observation.bootId !== identity.bootId ||
        observation.linuxStartTicks !== identity.linuxStartTicks)
    )
  }
  if (observation.status === 'missing') {
    return true
  }
  if (observation.status !== 'present') {
    return false
  }
  if (identity.startedAtMs === undefined || observation.startedAtMs === undefined) {
    return false
  }
  return observation.startedAtMs !== identity.startedAtMs
}

async function readCurrentLinuxIdentity(): Promise<TerminalAuthorityOwnerProcessIdentity> {
  try {
    const [statLine, scope] = await Promise.all([
      readFile('/proc/self/stat', 'utf8'),
      readCurrentTerminalAuthorityExecutionScope()
    ])
    const linuxStartTicks = parseLinuxStartTicks(statLine)
    return Object.freeze({
      pid: process.pid,
      platform: 'linux',
      ...scope,
      ...(linuxStartTicks && scope.bootId && scope.linuxPidNamespace
        ? {
            linuxStartTicks,
            linuxPidNamespace: scope.linuxPidNamespace,
            bootId: scope.bootId
          }
        : {})
    })
  } catch {
    const scope = await readCurrentTerminalAuthorityExecutionScope()
    return Object.freeze({
      pid: process.pid,
      platform: 'linux',
      ...scope
    })
  }
}

async function inspectTerminalAuthorityOwnerProcess(
  pid: number
): Promise<TerminalAuthorityOwnerProcessObservation> {
  const scope = await readCurrentTerminalAuthorityExecutionScope()
  const signal = inspectProcessSignal(pid)
  if (signal === 'missing') {
    return Object.freeze({
      status: 'missing',
      platform: process.platform,
      ...scope
    })
  }
  if (signal !== 'occupied') {
    return Object.freeze({
      status: 'unknown',
      platform: process.platform,
      ...scope
    })
  }
  if (process.platform === 'linux') {
    const [stat, linuxPidNamespace] = await Promise.all([
      readLinuxStat(pid),
      readTerminalAuthorityLinuxPidNamespace(pid)
    ])
    if (stat.status === 'missing') {
      return Object.freeze({
        status: 'missing',
        platform: 'linux',
        ...scope
      })
    }
    if (stat.status !== 'present' || !scope.bootId || !linuxPidNamespace) {
      return Object.freeze({
        status: 'unknown',
        platform: 'linux',
        ...scope,
        ...(linuxPidNamespace ? { linuxPidNamespace } : {})
      })
    }
    const linuxStartTicks = parseLinuxStartTicks(stat.value)
    return Object.freeze({
      status: 'present',
      platform: 'linux',
      ...scope,
      linuxPidNamespace,
      ...(linuxStartTicks ? { linuxStartTicks } : {})
    })
  }
  if (process.platform === 'darwin') {
    const startedAtMs = await readMacosProcessStartedAtMs(pid)
    return Object.freeze({
      status: 'present',
      platform: 'darwin',
      ...scope,
      ...(startedAtMs === null ? {} : { startedAtMs })
    })
  }
  if (process.platform === 'win32') {
    const processIdentity = await queryWindowsProcess(pid)
    if (processIdentity.status === 'missing') {
      return Object.freeze({ status: 'missing', platform: 'win32', ...scope })
    }
    if (processIdentity.status !== 'present') {
      return Object.freeze({ status: 'unknown', platform: 'win32', ...scope })
    }
    return Object.freeze({
      status: 'present',
      platform: 'win32',
      ...scope,
      ...(processIdentity.startedAtMs === null ? {} : { startedAtMs: processIdentity.startedAtMs })
    })
  }
  return Object.freeze({ status: 'present', platform: process.platform, ...scope })
}
