import {
  SshPtyLegacyProjectionLedger,
  type LegacySshProjectionSemantics
} from './ssh-pty-legacy-projection'
import { SshPtyModelAdmission } from './ssh-pty-model-admission'
import { settleSshPtyOutputExit } from './ssh-pty-output-exit'
import { SshPtyOutputGenerationGuard } from './ssh-pty-output-generation-guard'
import {
  SshPtyOutputSourceObligations,
  type SshPtyOutputSourceReservation
} from './ssh-pty-output-source-obligations'
import type {
  SshPtyOutputDataEvent,
  SshPtyOutputExitEvent,
  SshPtyOutputIntakeDependencies,
  SshPtyOutputIntakeOptions,
  SshPtyOutputReceipt
} from './ssh-pty-output-intake-contract'
import { outputIntakeError, type SshPtyExitBarrier } from './ssh-pty-output-intake-validation'

export type {
  SshPtyOutputDataEvent,
  SshPtyOutputExitEvent,
  SshPtyOutputIntakeDependencies,
  SshPtyOutputIntakeOptions,
  SshPtyOutputReceipt
} from './ssh-pty-output-intake-contract'

export class SshPtyOutputIntake {
  private readonly projections: SshPtyLegacyProjectionLedger
  private readonly sourceObligations: SshPtyOutputSourceObligations
  private readonly generationGuard = new SshPtyOutputGenerationGuard(() => this.disposed)
  private readonly admission: SshPtyModelAdmission
  private readonly exitBarrierMs: number
  private readonly exitBarriersByGeneration = new Map<number, Set<SshPtyExitBarrier>>()
  private disposed = false

  constructor(
    private readonly dependencies: SshPtyOutputIntakeDependencies,
    options: SshPtyOutputIntakeOptions = {}
  ) {
    this.sourceObligations = new SshPtyOutputSourceObligations(dependencies.publishSourceAck)
    this.projections = new SshPtyLegacyProjectionLedger({
      onSettled: (span) => this.sourceObligations.settleDesktop(span, 'renderer-parse'),
      onTransferred: (span, reason) => this.sourceObligations.transferDesktop(span, reason)
    })
    this.exitBarrierMs = options.exitBarrierMs ?? 30_000
    this.admission = new SshPtyModelAdmission({
      ...options,
      pauseProvider: (key) =>
        this.dependencies.pauseProvider?.(key.providerGeneration, key.ptyId) ?? false,
      resumeProvider: (key) =>
        this.dependencies.resumeProvider?.(key.providerGeneration, key.ptyId),
      closeProvider: (providerGeneration, reason) =>
        this.dependencies.closeProvider?.(providerGeneration, reason)
    })
  }

  acceptData(event: SshPtyOutputDataEvent): Promise<SshPtyOutputReceipt> {
    try {
      this.generationGuard.validateData(event)
    } catch (error) {
      return Promise.reject(error)
    }
    let projection: LegacySshProjectionSemantics | undefined
    let sourceReservation: SshPtyOutputSourceReservation | undefined
    const receipt = this.admission.accept(
      { ptyId: event.id, providerGeneration: event.providerGeneration },
      event.data,
      event.rawLength,
      () => {
        const expectedSequence = this.dependencies.getModelSequence(event.id) + event.rawLength
        const reservation = this.projections.reserve({
          ptyId: event.id,
          providerGeneration: event.providerGeneration,
          ptyIncarnation: event.ptyIncarnation,
          data: event.data,
          sequenceEnd: expectedSequence,
          rawLength: event.rawLength,
          transformed: event.transformed,
          source: event.source
        })
        try {
          if (reservation.semantics.desktopSpan) {
            sourceReservation = this.sourceObligations.reserve(
              event,
              reservation.semantics.desktopSpan
            )
          }
        } catch (error) {
          this.projections.rollback(reservation)
          throw error
        }
        try {
          projection = this.projections.commit(reservation)
          if (sourceReservation) {
            this.sourceObligations.commit(sourceReservation, event.id)
          }
        } catch (error) {
          if (sourceReservation) {
            this.sourceObligations.rollback(sourceReservation)
          }
          if (!this.projections.rollbackCommitted(reservation)) {
            this.projections.rollback(reservation)
          }
          throw error
        }
        let model: { sequence: number; completion: Promise<void> }
        try {
          model = this.dependencies.acceptModel(event, projection)
        } catch (error) {
          if (sourceReservation) {
            this.sourceObligations.rollback(sourceReservation)
          }
          this.projections.rollbackCommitted(reservation)
          throw error
        }
        try {
          this.dependencies.project(event, projection)
        } catch {
          const id = projection.identity.projectionSemanticsId
          this.projections.transfer([id], 'projection-admission-failed')
        }
        return model
      }
    )
    return receipt.then(
      (modelReceipt) => {
        if (!projection) {
          throw outputIntakeError('ssh_projection_receipt_missing')
        }
        if (sourceReservation) {
          this.sourceObligations.settleModel(sourceReservation.span)
        }
        return Object.freeze({ ...modelReceipt, projection })
      },
      (error) => {
        if (projection) {
          this.projections.transfer(
            [projection.identity.projectionSemanticsId],
            'model-admission-failed'
          )
        }
        this.dependencies.closeProvider?.(event.providerGeneration, 'model-admission-failed')
        throw error
      }
    )
  }

  async acceptExit(event: SshPtyOutputExitEvent): Promise<void> {
    this.generationGuard.sealExit(event)
    this.sourceObligations.sealPty(event)
    await this.withExitDeadline(event.providerGeneration, this.finishExit(event))
  }

  private async finishExit(event: SshPtyOutputExitEvent): Promise<void> {
    await settleSshPtyOutputExit({
      event,
      admission: this.admission,
      projections: this.projections,
      dependencies: this.dependencies,
      validateGeneration: () => this.generationGuard.validate(event),
      beforeFinalize: () => this.sourceObligations.markExitPublished(event)
    })
  }

  publishProjectionPrefix(
    ids: readonly string[],
    displayChars: number,
    accountingChars: number
  ): void {
    this.projections.publishPrefix(ids, displayChars, accountingChars)
  }

  settleProjectionPrefix(ptyId: string, accountingChars: number): number {
    return this.projections.settlePublishedPrefix(ptyId, accountingChars)
  }

  transferProjections(ids: readonly string[], reason: string): number {
    return this.projections.transfer(ids, reason)
  }

  transferPtyProjections(ptyId: string, reason: string): number {
    return this.projections.transferPty(ptyId, reason)
  }

  hasProjectionFromGeneration(ids: readonly string[], providerGeneration: number): boolean {
    return ids.some(
      (id) => this.projections.get(id)?.identity.providerGeneration === providerGeneration
    )
  }

  closeGeneration(providerGeneration: number, reason: string): void {
    this.generationGuard.closeGeneration(providerGeneration)
    this.admission.closeGeneration(providerGeneration, reason)
    this.dependencies.onGenerationClosed?.(providerGeneration, reason)
    this.projections.closeGeneration(providerGeneration, reason)
    this.sourceObligations.closeGeneration(providerGeneration, reason)
    const barriers = this.exitBarriersByGeneration.get(providerGeneration)
    if (barriers) {
      for (const barrier of barriers) {
        clearTimeout(barrier.timer)
        barrier.reject(outputIntakeError(reason))
      }
      this.exitBarriersByGeneration.delete(providerGeneration)
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const generation of this.generationGuard.activeGenerations()) {
      this.closeGeneration(generation, 'ssh_output_intake_disposed')
    }
    this.admission.dispose()
    this.sourceObligations.dispose()
  }

  getRemoteSourceRangeConsumerHooks() {
    return this.sourceObligations.remoteHooks
  }

  getAcceptedSourceCheckpoints(providerGeneration: number) {
    return this.sourceObligations.acceptedCheckpoints(providerGeneration)
  }

  getDebugSnapshot() {
    return {
      model: this.admission.getDebugSnapshot(),
      projection: this.projections.getDebugSnapshot(),
      source: this.sourceObligations.getDebugSnapshot(),
      exitBarriers: Array.from(this.exitBarriersByGeneration.values()).reduce(
        (total, barriers) => total + barriers.size,
        0
      )
    }
  }

  private withExitDeadline(providerGeneration: number, promise: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const barrier: SshPtyExitBarrier = {
        timer: setTimeout(() => {
          this.removeExitBarrier(providerGeneration, barrier)
          this.dependencies.closeProvider?.(providerGeneration, 'ssh-exit-barrier-timeout')
          reject(outputIntakeError('ssh_exit_barrier_timeout'))
        }, this.exitBarrierMs),
        reject
      }
      barrier.timer.unref?.()
      let barriers = this.exitBarriersByGeneration.get(providerGeneration)
      if (!barriers) {
        barriers = new Set()
        this.exitBarriersByGeneration.set(providerGeneration, barriers)
      }
      barriers.add(barrier)
      void promise.then(
        () => {
          clearTimeout(barrier.timer)
          this.removeExitBarrier(providerGeneration, barrier)
          resolve()
        },
        (error) => {
          clearTimeout(barrier.timer)
          this.removeExitBarrier(providerGeneration, barrier)
          reject(error)
        }
      )
    })
  }

  private removeExitBarrier(providerGeneration: number, barrier: SshPtyExitBarrier): void {
    const barriers = this.exitBarriersByGeneration.get(providerGeneration)
    barriers?.delete(barrier)
    if (barriers?.size === 0) {
      this.exitBarriersByGeneration.delete(providerGeneration)
    }
  }
}
