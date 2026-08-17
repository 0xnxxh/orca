export const MAX_SSH_PTY_EXIT_TOMBSTONES = 1000

export type SshPtyLiveEvidence = { valid: boolean }

export class SshPtyLivenessState {
  readonly livePtyIds = new Set<string>()
  private readonly exitedPtyIds = new Set<string>()
  private readonly pendingLiveEvidenceByPtyId = new Map<string, Set<SshPtyLiveEvidence>>()

  constructor(private readonly toAppPtyId: (id: string) => string) {}

  clear(): void {
    for (const evidence of this.pendingLiveEvidenceByPtyId.values()) {
      for (const pending of evidence) {
        pending.valid = false
      }
    }
    this.pendingLiveEvidenceByPtyId.clear()
    this.livePtyIds.clear()
    this.exitedPtyIds.clear()
  }

  probe(id: string): boolean | null {
    return this.livePtyIds.has(id) ? true : this.exitedPtyIds.has(id) ? false : null
  }

  acceptLive(id: string): void {
    const appPtyId = this.toAppPtyId(id)
    this.exitedPtyIds.delete(appPtyId)
    this.livePtyIds.add(appPtyId)
  }

  beginLiveEvidence(id: string): SshPtyLiveEvidence {
    const appPtyId = this.toAppPtyId(id)
    const evidence = { valid: true }
    const pending = this.pendingLiveEvidenceByPtyId.get(appPtyId) ?? new Set()
    pending.add(evidence)
    this.pendingLiveEvidenceByPtyId.set(appPtyId, pending)
    return evidence
  }

  settleLiveEvidence(id: string, evidence: SshPtyLiveEvidence, acceptLive: boolean): void {
    const appPtyId = this.toAppPtyId(id)
    const pending = this.pendingLiveEvidenceByPtyId.get(appPtyId)
    const wasPending = pending?.delete(evidence) === true
    if (pending?.size === 0) {
      this.pendingLiveEvidenceByPtyId.delete(appPtyId)
    }
    const wasValid = evidence.valid
    evidence.valid = false
    if (acceptLive && wasPending && wasValid) {
      this.acceptLive(appPtyId)
    }
  }

  acceptUnverifiable(id: string): void {
    const appPtyId = this.toAppPtyId(id)
    this.invalidateLiveEvidence(appPtyId)
    this.livePtyIds.delete(appPtyId)
  }

  acceptExited(id: string): void {
    const appPtyId = this.toAppPtyId(id)
    this.invalidateLiveEvidence(appPtyId)
    this.livePtyIds.delete(appPtyId)
    this.exitedPtyIds.delete(appPtyId)
    this.exitedPtyIds.add(appPtyId)
    if (this.exitedPtyIds.size > MAX_SSH_PTY_EXIT_TOMBSTONES) {
      const oldest = this.exitedPtyIds.values().next().value
      if (oldest !== undefined) {
        this.exitedPtyIds.delete(oldest)
      }
    }
  }

  private invalidateLiveEvidence(appPtyId: string): void {
    const pending = this.pendingLiveEvidenceByPtyId.get(appPtyId)
    if (!pending) {
      return
    }
    for (const evidence of pending) {
      evidence.valid = false
    }
    this.pendingLiveEvidenceByPtyId.delete(appPtyId)
  }
}
