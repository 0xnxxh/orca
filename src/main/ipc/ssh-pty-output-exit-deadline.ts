import type { SshPtyLegacyProjectionLedger } from './ssh-pty-legacy-projection'
import type { SshPtyModelAdmission } from './ssh-pty-model-admission'
import type {
  SshPtyOutputExitEvent,
  SshPtyOutputIntakeDependencies
} from './ssh-pty-output-intake-contract'
import { outputIntakeError, type SshPtyExitBarrier } from './ssh-pty-output-intake-validation'
import type { SshPtyOutputSourceObligations } from './ssh-pty-output-source-obligations'

type SshPtyOutputExitDeadlineDependencies = Readonly<{
  admission: SshPtyModelAdmission
  projections: SshPtyLegacyProjectionLedger
  sourceObligations: SshPtyOutputSourceObligations
  intake: SshPtyOutputIntakeDependencies
  barrierMs?: number
  cancellationProofMs?: number
}>

export class SshPtyOutputExitDeadline {
  private readonly barriersByGeneration = new Map<number, Set<SshPtyExitBarrier>>()
  private readonly barrierMs: number
  private readonly cancellationProofMs: number

  constructor(private readonly dependencies: SshPtyOutputExitDeadlineDependencies) {
    this.barrierMs = dependencies.barrierMs ?? 30_000
    this.cancellationProofMs = dependencies.cancellationProofMs ?? 10_000
  }

  wait(event: SshPtyOutputExitEvent, promise: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutStarted = false
      let settled = false
      const settle = (result: { ok: true } | { ok: false; error: Error }): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(barrier.timer)
        this.remove(event.providerGeneration, barrier)
        if (result.ok) {
          resolve()
        } else {
          reject(result.error)
        }
      }
      const barrier: SshPtyExitBarrier = {
        timer: setTimeout(() => {
          timeoutStarted = true
          void this.cancelTimedOutExit(event).then(
            () => settle({ ok: true }),
            (error) => {
              this.dependencies.intake.closeProvider?.(
                event.providerGeneration,
                'ssh-exit-cancellation-proof-failed'
              )
              settle({
                ok: false,
                error: error instanceof Error ? error : outputIntakeError(String(error))
              })
            }
          )
        }, this.barrierMs),
        reject: (error) => settle({ ok: false, error })
      }
      barrier.timer.unref?.()
      let barriers = this.barriersByGeneration.get(event.providerGeneration)
      if (!barriers) {
        barriers = new Set()
        this.barriersByGeneration.set(event.providerGeneration, barriers)
      }
      barriers.add(barrier)
      void promise.then(
        () => {
          if (!timeoutStarted) {
            settle({ ok: true })
          }
        },
        (error) => {
          if (!timeoutStarted) {
            settle({ ok: false, error })
          }
        }
      )
    })
  }

  closeGeneration(providerGeneration: number, error: Error): void {
    const barriers = this.barriersByGeneration.get(providerGeneration)
    if (!barriers) {
      return
    }
    for (const barrier of barriers) {
      clearTimeout(barrier.timer)
      barrier.reject(error)
    }
    this.barriersByGeneration.delete(providerGeneration)
  }

  get activeBarriers(): number {
    return Array.from(this.barriersByGeneration.values()).reduce(
      (total, barriers) => total + barriers.size,
      0
    )
  }

  private async cancelTimedOutExit(event: SshPtyOutputExitEvent): Promise<void> {
    const cancel = this.dependencies.intake.cancelSourceDelivery
    if (!cancel) {
      throw outputIntakeError('ssh_source_cancellation_publisher_unavailable')
    }
    this.dependencies.admission.cancelPty(
      { ptyId: event.id, providerGeneration: event.providerGeneration },
      'ssh_exit_delivery_canceled'
    )
    this.dependencies.sourceObligations.sealPty(event)
    const cancellation = this.dependencies.sourceObligations.cancelPty(event, (request) =>
      cancel(event.providerGeneration, request)
    )
    const canceled = await this.withCancellationProofDeadline(cancellation)
    if (!canceled) {
      throw outputIntakeError('ssh_source_cancellation_identity_unavailable')
    }
    this.dependencies.projections.transferPty(event.id, 'ssh-exit-delivery-canceled')
    this.dependencies.intake.prepareExit(event)
    this.dependencies.intake.finalizeExit(event)
    this.dependencies.projections.closePty(
      event.id,
      event.providerGeneration,
      event.ptyIncarnation,
      'ssh-exit-delivery-canceled'
    )
  }

  private withCancellationProofDeadline<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(outputIntakeError('ssh_source_cancellation_proof_timeout')),
        this.cancellationProofMs
      )
      timer.unref?.()
      void promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })
  }

  private remove(providerGeneration: number, barrier: SshPtyExitBarrier): void {
    const barriers = this.barriersByGeneration.get(providerGeneration)
    barriers?.delete(barrier)
    if (barriers?.size === 0) {
      this.barriersByGeneration.delete(providerGeneration)
    }
  }
}
