import type { Store } from '../persistence'
import type {
  SshTerminalAuthorityExitTarget,
  SshTerminalAuthorityExitWait
} from './ssh-terminal-session-termination'

export const SSH_TERMINAL_AUTHORITY_EXIT_WAIT_MS = 12_000
const MAX_SSH_TERMINAL_PHYSICAL_EXIT_OBSERVERS = 4_096

export type SshTerminalPhysicalExit = Readonly<{
  targetId: string
  relayPtyId: string
  ptyIncarnationId: string
  code: number
}>

type PhysicalExitObserver = Readonly<{
  resolve: (exit: SshTerminalPhysicalExit) => void
}>

type PhysicalExitObservation = Readonly<{
  completion: Promise<SshTerminalPhysicalExit>
  dispose(): void
}>

const physicalExitObservers = new Map<string, Set<PhysicalExitObserver>>()
let physicalExitObserverCount = 0

export function prepareSshTerminalAuthorityExitWait(
  store: Store,
  target: SshTerminalAuthorityExitTarget,
  timeoutMs = SSH_TERMINAL_AUTHORITY_EXIT_WAIT_MS
): SshTerminalAuthorityExitWait {
  const observation = observeSshTerminalPhysicalExit(
    target.targetId,
    target.relayPtyId,
    target.authorityAccess.binding.ptyIncarnationId
  )
  let closeRequest: 'recorded' | 'duplicate'
  try {
    closeRequest = store.requestSshRemotePtyClose(target.targetId, target.relayPtyId, {
      incarnationId: target.authorityAccess.binding.ptyIncarnationId,
      terminalSessionAuthorityAccess: target.authorityAccess,
      keepHistory: false,
      requestedAt: Date.now()
    })
  } catch (error) {
    observation.dispose()
    throw error
  }
  return createExitWait(store, target, observation, closeRequest === 'recorded', timeoutMs)
}

function createExitWait(
  store: Store,
  target: SshTerminalAuthorityExitTarget,
  observation: PhysicalExitObservation,
  ownsCloseRequest: boolean,
  timeoutMs: number
): SshTerminalAuthorityExitWait {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs))
    timer.unref?.()
  })
  return Object.freeze({
    completion: Promise.race([observation.completion.then(() => true), timeout]),
    cancelUnsent: () => {
      if (!ownsCloseRequest) {
        return
      }
      store.clearSshRemotePtyCloseRequest(
        target.targetId,
        target.relayPtyId,
        target.authorityAccess
      )
    },
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      observation.dispose()
    }
  })
}

export function publishSshTerminalPhysicalExit(exit: SshTerminalPhysicalExit): void {
  if (!validPhysicalExit(exit)) {
    return
  }
  const key = physicalExitKey(exit.targetId, exit.relayPtyId, exit.ptyIncarnationId)
  const observers = physicalExitObservers.get(key)
  if (!observers) {
    return
  }
  physicalExitObservers.delete(key)
  physicalExitObserverCount -= observers.size
  const published = Object.freeze({ ...exit })
  for (const observer of observers) {
    observer.resolve(published)
  }
}

function observeSshTerminalPhysicalExit(
  targetId: string,
  relayPtyId: string,
  ptyIncarnationId: string
): PhysicalExitObservation {
  if (!validPhysicalExitIdentity(targetId, relayPtyId, ptyIncarnationId)) {
    throw new Error('ssh_terminal_physical_exit_observer_invalid')
  }
  if (physicalExitObserverCount >= MAX_SSH_TERMINAL_PHYSICAL_EXIT_OBSERVERS) {
    throw new Error('ssh_terminal_physical_exit_observer_capacity')
  }
  const key = physicalExitKey(targetId, relayPtyId, ptyIncarnationId)
  let observer!: PhysicalExitObserver
  let active = true
  const completion = new Promise<SshTerminalPhysicalExit>((resolve) => {
    observer = Object.freeze({ resolve })
  })
  const observers = physicalExitObservers.get(key) ?? new Set<PhysicalExitObserver>()
  observers.add(observer)
  physicalExitObservers.set(key, observers)
  physicalExitObserverCount += 1
  return Object.freeze({
    completion,
    dispose: () => {
      if (!active) {
        return
      }
      active = false
      const current = physicalExitObservers.get(key)
      if (!current?.delete(observer)) {
        return
      }
      physicalExitObserverCount -= 1
      if (current.size === 0) {
        physicalExitObservers.delete(key)
      }
    }
  })
}

function validPhysicalExit(exit: SshTerminalPhysicalExit): boolean {
  return (
    validPhysicalExitIdentity(exit.targetId, exit.relayPtyId, exit.ptyIncarnationId) &&
    Number.isSafeInteger(exit.code)
  )
}

function validPhysicalExitIdentity(
  targetId: string,
  relayPtyId: string,
  ptyIncarnationId: string
): boolean {
  return (
    targetId.length > 0 &&
    targetId.length <= 512 &&
    relayPtyId.length > 0 &&
    relayPtyId.length <= 512 &&
    ptyIncarnationId.length > 0 &&
    ptyIncarnationId.length <= 512
  )
}

function physicalExitKey(targetId: string, relayPtyId: string, ptyIncarnationId: string): string {
  return JSON.stringify([targetId, relayPtyId, ptyIncarnationId])
}
