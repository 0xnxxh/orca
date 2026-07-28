import type {
  SshPtyModelAdmissionDebugSnapshot,
  SshPtyModelAdmissionKey,
  SshPtyModelAdmissionOptions,
  SshPtyModelAdmissionReceipt
} from './ssh-pty-model-admission-contract'
import {
  admissionError,
  admissionKeyId,
  canReserveAdmission,
  cancelAdmissionGeneration,
  pressureHasAdmissionKey,
  retainedBytes,
  resolveAdmissionIdleWaiters,
  takePausedGeneration,
  type AdmissionCharge,
  type AdmissionEntry,
  type PtyUsage
} from './ssh-pty-model-admission-entry'
import {
  resolveSshPtyModelAdmissionLimits,
  type SshPtyModelAdmissionLimits
} from './ssh-pty-model-admission-limits'

export type {
  SshPtyModelAdmissionKey,
  SshPtyModelAdmissionOptions,
  SshPtyModelAdmissionReceipt
} from './ssh-pty-model-admission-contract'

export class SshPtyModelAdmission {
  private readonly limits: SshPtyModelAdmissionLimits
  private readonly pauseProvider: (key: SshPtyModelAdmissionKey) => boolean
  private readonly resumeProvider: (key: SshPtyModelAdmissionKey) => void
  private readonly closeProvider: (providerGeneration: number, reason: string) => void
  private readonly usageByPty = new Map<string, PtyUsage>()
  private readonly pressure: AdmissionEntry[] = []
  private readonly pausedKeys = new Map<string, SshPtyModelAdmissionKey>()
  private readonly idleWaiters = new Map<string, Set<() => void>>()
  private readonly closingGenerations = new Set<number>()
  private globalSourceUnits = 0
  private globalBytes = 0
  private pressureBytes = 0
  private disposed = false

  constructor(options: SshPtyModelAdmissionOptions = {}) {
    this.limits = resolveSshPtyModelAdmissionLimits(options)
    this.pauseProvider = options.pauseProvider ?? (() => false)
    this.resumeProvider = options.resumeProvider ?? (() => {})
    this.closeProvider = options.closeProvider ?? (() => {})
  }

  accept(
    key: SshPtyModelAdmissionKey,
    data: string,
    sourceUnits: number,
    run: () => { sequence: number; completion: Promise<void> }
  ): Promise<SshPtyModelAdmissionReceipt> {
    if (this.disposed) {
      return Promise.reject(admissionError('ssh_model_admission_disposed'))
    }
    if (this.closingGenerations.has(key.providerGeneration)) {
      return Promise.reject(admissionError('ssh_model_admission_generation_closed'))
    }
    const charge = { sourceUnits, bytes: retainedBytes(data) }
    return new Promise((resolve, reject) => {
      const entry: AdmissionEntry = {
        key: { ...key },
        charge,
        run,
        resolve,
        reject,
        state: 'queued'
      }
      if (this.canReserve(key, charge) && !pressureHasAdmissionKey(this.pressure, key)) {
        this.reserveAndQueue(entry)
        return
      }
      this.admitPressure(entry)
    })
  }

  closeGeneration(providerGeneration: number, reason = 'provider-generation-closed'): void {
    this.closingGenerations.add(providerGeneration)
    const error = admissionError(reason)
    this.pressureBytes -= cancelAdmissionGeneration({
      pressure: this.pressure,
      usageByPty: this.usageByPty,
      idleWaiters: this.idleWaiters,
      providerGeneration,
      error,
      release: (key, charge) => this.release(key, charge)
    })
    for (const key of takePausedGeneration(this.pausedKeys, providerGeneration)) {
      try {
        this.resumeProvider(key)
      } catch {}
    }
    const generationPrefix = `${providerGeneration}\0`
    for (const id of this.idleWaiters.keys()) {
      if (id.startsWith(generationPrefix)) {
        resolveAdmissionIdleWaiters(this.usageByPty, this.pressure, this.idleWaiters, id)
      }
    }
  }

  whenIdle(key: SshPtyModelAdmissionKey): Promise<void> {
    const id = admissionKeyId(key)
    const usage = this.usageByPty.get(id)
    const hasPressure = this.pressure.some(
      (entry) =>
        entry.key.providerGeneration === key.providerGeneration && entry.key.ptyId === key.ptyId
    )
    if ((!usage || (!usage.running && usage.queued.length === 0)) && !hasPressure) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const waiters = this.idleWaiters.get(id) ?? new Set<() => void>()
      waiters.add(resolve)
      this.idleWaiters.set(id, waiters)
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const generations = new Set<number>()
    for (const usage of this.usageByPty.values()) {
      if (usage.running) {
        generations.add(usage.running.key.providerGeneration)
      }
      for (const entry of usage.queued) {
        generations.add(entry.key.providerGeneration)
      }
    }
    for (const entry of this.pressure) {
      generations.add(entry.key.providerGeneration)
    }
    for (const generation of generations) {
      this.closeGeneration(generation, 'ssh_model_admission_disposed')
    }
  }

  getDebugSnapshot(): SshPtyModelAdmissionDebugSnapshot {
    return {
      sourceUnits: this.globalSourceUnits,
      bytes: this.globalBytes,
      pressureFrames: this.pressure.length,
      pressureBytes: this.pressureBytes,
      pausedPtys: this.pausedKeys.size
    }
  }

  private canReserve(key: SshPtyModelAdmissionKey, charge: AdmissionCharge): boolean {
    return canReserveAdmission({
      key,
      charge,
      limits: this.limits,
      usageByPty: this.usageByPty,
      closingGenerations: this.closingGenerations,
      globalSourceUnits: this.globalSourceUnits,
      globalBytes: this.globalBytes
    })
  }

  private reserveAndQueue(entry: AdmissionEntry): void {
    const id = admissionKeyId(entry.key)
    let usage = this.usageByPty.get(id)
    if (!usage) {
      usage = { sourceUnits: 0, bytes: 0, queued: [], running: null }
      this.usageByPty.set(id, usage)
    }
    usage.sourceUnits += entry.charge.sourceUnits
    usage.bytes += entry.charge.bytes
    this.globalSourceUnits += entry.charge.sourceUnits
    this.globalBytes += entry.charge.bytes
    entry.state = 'queued'
    usage.queued.push(entry)
    this.startNext(id, usage)
  }

  private admitPressure(entry: AdmissionEntry): void {
    const id = admissionKeyId(entry.key)
    const paused = this.pausedKeys.has(id) || this.pauseProvider(entry.key)
    if (paused) {
      this.pausedKeys.set(id, entry.key)
    }
    if (
      !paused ||
      this.pressure.length >= this.limits.pressureMaxFrames ||
      this.pressureBytes + entry.charge.bytes > this.limits.pressureMaxBytes
    ) {
      entry.reject(admissionError('ssh_model_admission_pressure_exhausted'))
      this.closeProvider(entry.key.providerGeneration, 'model-admission-pressure')
      return
    }
    entry.state = 'pressure'
    this.pressure.push(entry)
    this.pressureBytes += entry.charge.bytes
  }

  private startNext(id: string, usage: PtyUsage): void {
    if (usage.running) {
      return
    }
    const entry = usage.queued.shift()
    if (!entry) {
      this.maybeResumeAndPromote()
      return
    }
    usage.running = entry
    entry.state = 'running'
    let execution: { sequence: number; completion: Promise<void> }
    try {
      execution = entry.run()
    } catch (error) {
      if (this.finishEntry(id, usage, entry)) {
        entry.reject(error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    void execution.completion.then(
      () => {
        if (!this.finishEntry(id, usage, entry)) {
          return
        }
        entry.resolve({
          ptyId: entry.key.ptyId,
          providerGeneration: entry.key.providerGeneration,
          sequence: execution.sequence
        })
      },
      (error) => {
        if (this.finishEntry(id, usage, entry)) {
          entry.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    )
  }

  private finishEntry(id: string, usage: PtyUsage, entry: AdmissionEntry): boolean {
    if (entry.state !== 'running' || usage.running !== entry) {
      return false
    }
    usage.running = null
    entry.state = 'settled'
    this.release(entry.key, entry.charge)
    this.cleanupUsage(id, usage)
    return true
  }

  private cleanupUsage(id: string, usage: PtyUsage): void {
    this.startNext(id, usage)
    if (!usage.running && usage.queued.length === 0 && usage.sourceUnits === 0) {
      this.usageByPty.delete(id)
    }
    resolveAdmissionIdleWaiters(this.usageByPty, this.pressure, this.idleWaiters, id)
  }

  private release(key: SshPtyModelAdmissionKey, charge: AdmissionCharge): void {
    const usage = this.usageByPty.get(admissionKeyId(key))
    if (usage) {
      usage.sourceUnits = Math.max(0, usage.sourceUnits - charge.sourceUnits)
      usage.bytes = Math.max(0, usage.bytes - charge.bytes)
    }
    this.globalSourceUnits = Math.max(0, this.globalSourceUnits - charge.sourceUnits)
    this.globalBytes = Math.max(0, this.globalBytes - charge.bytes)
    this.maybeResumeAndPromote()
  }

  private maybeResumeAndPromote(): void {
    if (this.disposed) {
      return
    }
    for (let index = 0; index < this.pressure.length; ) {
      const entry = this.pressure[index]!
      const hasEarlierEntryForPty = this.pressure
        .slice(0, index)
        .some((earlier) => admissionKeyId(earlier.key) === admissionKeyId(entry.key))
      if (hasEarlierEntryForPty || !this.canReserve(entry.key, entry.charge)) {
        index++
        continue
      }
      this.pressure.splice(index, 1)
      this.pressureBytes -= entry.charge.bytes
      this.reserveAndQueue(entry)
    }
    if (
      this.globalSourceUnits > this.limits.globalLowSourceUnits ||
      this.globalBytes > this.limits.globalLowBytes
    ) {
      return
    }
    for (const [id, key] of this.pausedKeys) {
      const usage = this.usageByPty.get(id)
      const stillPressured = this.pressure.some(
        (entry) =>
          entry.key.providerGeneration === key.providerGeneration && entry.key.ptyId === key.ptyId
      )
      if (
        stillPressured ||
        (usage?.sourceUnits ?? 0) > this.limits.perPtyLowSourceUnits ||
        (usage?.bytes ?? 0) > this.limits.perPtyLowBytes
      ) {
        continue
      }
      this.pausedKeys.delete(id)
      try {
        this.resumeProvider(key)
      } catch {}
    }
  }
}
