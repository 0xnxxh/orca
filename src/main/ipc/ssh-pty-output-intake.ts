import {
  SshPtyLegacyProjectionLedger,
  type LegacySshProjectionSemantics
} from './ssh-pty-legacy-projection'
import { SshPtyModelAdmission } from './ssh-pty-model-admission'
import type {
  SshPtyOutputDataEvent,
  SshPtyOutputExitEvent,
  SshPtyOutputIntakeDependencies,
  SshPtyOutputIntakeOptions,
  SshPtyOutputReceipt
} from './ssh-pty-output-intake-contract'
import {
  outputIntakeError,
  sshPtyGenerationKey,
  validOutputLength,
  type SshPtyExitBarrier
} from './ssh-pty-output-intake-validation'

export type {
  SshPtyOutputDataEvent,
  SshPtyOutputExitEvent,
  SshPtyOutputIntakeDependencies,
  SshPtyOutputIntakeOptions,
  SshPtyOutputReceipt
} from './ssh-pty-output-intake-contract'

export class SshPtyOutputIntake {
  private readonly projections = new SshPtyLegacyProjectionLedger()
  private readonly admission: SshPtyModelAdmission
  private readonly exitBarrierMs: number
  private readonly latestGenerationByPty = new Map<string, number>()
  private readonly incarnationByPty = new Map<string, string>()
  private readonly sealedPtys = new Set<string>()
  private readonly closedGenerations = new Set<number>()
  private readonly exitBarriersByGeneration = new Map<number, Set<SshPtyExitBarrier>>()
  private disposed = false

  constructor(
    private readonly dependencies: SshPtyOutputIntakeDependencies,
    options: SshPtyOutputIntakeOptions = {}
  ) {
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
      this.validateDataEvent(event)
    } catch (error) {
      return Promise.reject(error)
    }
    let projection: LegacySshProjectionSemantics | undefined
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
          transformed: event.transformed
        })
        let model: { sequence: number; completion: Promise<void> }
        try {
          model = this.dependencies.acceptModel(event)
        } catch (error) {
          this.projections.rollback(reservation)
          throw error
        }
        projection = this.projections.commit(reservation)
        try {
          this.dependencies.project(event, projection)
        } catch {
          const id = projection.identity.projectionSemanticsId
          if (!this.projections.transferUnpublished(id, 'projection-admission-failed')) {
            this.projections.transfer([id], 'projection-admission-failed')
          }
        }
        return model
      }
    )
    return receipt.then(
      (modelReceipt) => {
        if (!projection) {
          throw outputIntakeError('ssh_projection_receipt_missing')
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
    this.validateGeneration(event)
    const sealKey = sshPtyGenerationKey(event.id, event.providerGeneration)
    if (this.sealedPtys.has(sealKey)) {
      throw outputIntakeError('ssh_output_duplicate_exit')
    }
    this.sealedPtys.add(sealKey)
    await this.withExitDeadline(
      event.providerGeneration,
      this.admission.whenIdle({
        ptyId: event.id,
        providerGeneration: event.providerGeneration
      })
    )
    this.validateGeneration(event)
    try {
      this.dependencies.finalizeExit(event)
      this.projections.closePty(
        event.id,
        event.providerGeneration,
        event.ptyIncarnation,
        'pty-exit'
      )
    } catch (error) {
      this.projections.closePty(
        event.id,
        event.providerGeneration,
        event.ptyIncarnation,
        'pty-exit-finalize-failed'
      )
      this.dependencies.closeProvider?.(event.providerGeneration, 'pty-exit-finalize-failed')
      throw error
    }
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
    this.closedGenerations.add(providerGeneration)
    this.admission.closeGeneration(providerGeneration, reason)
    this.dependencies.onGenerationClosed?.(providerGeneration, reason)
    this.projections.closeGeneration(providerGeneration, reason)
    const barriers = this.exitBarriersByGeneration.get(providerGeneration)
    if (barriers) {
      for (const barrier of barriers) {
        clearTimeout(barrier.timer)
        barrier.reject(outputIntakeError(reason))
      }
      this.exitBarriersByGeneration.delete(providerGeneration)
    }
    for (const [ptyId, generation] of this.latestGenerationByPty) {
      if (generation === providerGeneration) {
        this.latestGenerationByPty.delete(ptyId)
        this.incarnationByPty.delete(ptyId)
        this.sealedPtys.delete(sshPtyGenerationKey(ptyId, generation))
      }
    }
    const generationPrefix = `${providerGeneration}\0`
    for (const key of this.sealedPtys) {
      if (key.startsWith(generationPrefix)) {
        this.sealedPtys.delete(key)
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const generation of new Set(this.latestGenerationByPty.values())) {
      this.closeGeneration(generation, 'ssh_output_intake_disposed')
    }
    this.admission.dispose()
  }

  getDebugSnapshot() {
    return {
      model: this.admission.getDebugSnapshot(),
      projection: this.projections.getDebugSnapshot(),
      exitBarriers: Array.from(this.exitBarriersByGeneration.values()).reduce(
        (total, barriers) => total + barriers.size,
        0
      )
    }
  }

  private validateDataEvent(event: SshPtyOutputDataEvent): void {
    if (this.disposed) {
      throw outputIntakeError('ssh_output_intake_disposed')
    }
    if (
      !event.id ||
      !event.ptyIncarnation ||
      !Number.isSafeInteger(event.providerGeneration) ||
      event.providerGeneration <= 0 ||
      !validOutputLength(event.rawLength) ||
      (event.transformed && event.rawLength < 0)
    ) {
      throw outputIntakeError('ssh_output_invalid_event')
    }
    this.validateGeneration(event)
    if (this.sealedPtys.has(sshPtyGenerationKey(event.id, event.providerGeneration))) {
      throw outputIntakeError('ssh_output_after_exit')
    }
  }

  private validateGeneration(event: {
    id: string
    providerGeneration: number
    ptyIncarnation: string
  }): void {
    if (this.disposed) {
      throw outputIntakeError('ssh_output_intake_disposed')
    }
    if (this.closedGenerations.has(event.providerGeneration)) {
      throw outputIntakeError('ssh_output_stale_generation')
    }
    const generation = this.latestGenerationByPty.get(event.id)
    if (generation !== undefined && event.providerGeneration < generation) {
      throw outputIntakeError('ssh_output_stale_generation')
    }
    const incarnation = this.incarnationByPty.get(event.id)
    if (
      generation === event.providerGeneration &&
      incarnation !== undefined &&
      incarnation !== event.ptyIncarnation
    ) {
      throw outputIntakeError('ssh_output_stale_incarnation')
    }
    if (generation === undefined || event.providerGeneration > generation) {
      this.latestGenerationByPty.set(event.id, event.providerGeneration)
      this.incarnationByPty.set(event.id, event.ptyIncarnation)
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
