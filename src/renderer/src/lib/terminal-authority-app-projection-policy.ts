import type {
  TerminalAuthorityAppEventKey,
  TerminalAuthorityAppFactProjection,
  TerminalAuthorityAppPaneProjection
} from '../../../shared/terminal-authority-app-projection'
import {
  onTerminalSideEffectFactConsumerAvailable,
  settleTerminalAuthoritySideEffectBatch
} from '@/components/terminal-pane/terminal-side-effect-facts-handler'
import {
  applyAuthoritativePtyExit,
  onAuthoritativePtyExitPolicyAvailable
} from '@/components/terminal-pane/pty-authority-outcome-exit-policy'

const applications = new Map<string, Promise<boolean>>()

export function applyTerminalAuthorityAppProjectionFact(
  row: TerminalAuthorityAppPaneProjection,
  field: TerminalAuthorityAppFactProjection
): Promise<boolean> {
  if (!row.binding || !sameBinding(row.binding, field.binding)) {
    return Promise.resolve(false)
  }
  return coalesce(`${eventKey(field.event)}:${field.fact.kind}`, () =>
    settleTerminalAuthoritySideEffectBatch(
      {
        ptyId: field.binding.physicalPtyId,
        ptyIncarnationId: field.binding.ptyIncarnationId,
        seq: field.event.sequence,
        facts: [field.fact]
      },
      field.event
    )
  )
}

export function applyTerminalAuthorityAppProjectionExit(
  row: TerminalAuthorityAppPaneProjection
): Promise<boolean> {
  const exit = row.exit
  if (!exit) {
    return Promise.resolve(false)
  }
  return coalesce(`${eventKey(exit.event)}:exit`, () =>
    applyAuthoritativePtyExit({
      ptyId: exit.binding.physicalPtyId,
      code: exit.code ?? 0,
      incarnationId: exit.binding.ptyIncarnationId,
      authorityOutcome: exit.event
    })
  )
}

export function onTerminalAuthorityAppProjectionPolicyAvailable(listener: () => void): () => void {
  const stopSideEffects = onTerminalSideEffectFactConsumerAvailable(listener)
  const stopExit = onAuthoritativePtyExitPolicyAvailable(listener)
  return () => {
    stopSideEffects()
    stopExit()
  }
}

function coalesce(key: string, apply: () => boolean | Promise<boolean>): Promise<boolean> {
  const current = applications.get(key)
  if (current) {
    return current
  }
  const application = Promise.resolve().then(apply)
  applications.set(key, application)
  void application.finally(() => {
    if (applications.get(key) === application) {
      applications.delete(key)
    }
  })
  return application
}

function eventKey(event: TerminalAuthorityAppEventKey): string {
  return JSON.stringify([
    event.consumerId,
    event.namespace.authorityHostId,
    event.namespace.namespaceId,
    event.sequence,
    event.outcomeId
  ])
}

function sameBinding(
  left: { ownerIncarnationId: string; physicalPtyId: string; ptyIncarnationId: string },
  right: { ownerIncarnationId: string; physicalPtyId: string; ptyIncarnationId: string }
): boolean {
  return (
    left.ownerIncarnationId === right.ownerIncarnationId &&
    left.physicalPtyId === right.physicalPtyId &&
    left.ptyIncarnationId === right.ptyIncarnationId
  )
}
