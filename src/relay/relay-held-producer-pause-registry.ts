const MAX_HELD_PRODUCER_PAUSE_TOKENS = 4_096

type HeldProducerPause = {
  incarnationId: string
  tokens: Set<string>
}

type RelayHeldProducerPauseRegistryDeps = {
  resolveIncarnation: (id: string) => string | null
  pause: (id: string) => void
  resume: (id: string) => void
}

export class RelayHeldProducerPauseRegistry {
  private readonly pauses = new Map<string, HeldProducerPause>()
  private tokenCount = 0

  constructor(private readonly deps: RelayHeldProducerPauseRegistryDeps) {}

  set(id: string, incarnationId: string, token: string, paused: boolean): boolean {
    if (this.deps.resolveIncarnation(id) !== incarnationId) {
      return false
    }
    return paused ? this.acquire(id, incarnationId, token) : this.release(id, incarnationId, token)
  }

  has(id: string): boolean {
    return this.pauses.has(id)
  }

  clear(id: string): void {
    const current = this.pauses.get(id)
    if (!current) {
      return
    }
    this.pauses.delete(id)
    this.tokenCount -= current.tokens.size
  }

  clearAll(): void {
    this.pauses.clear()
    this.tokenCount = 0
  }

  private acquire(id: string, incarnationId: string, token: string): boolean {
    const current = this.pauses.get(id)
    if (current) {
      if (current.incarnationId !== incarnationId) {
        return false
      }
      if (current.tokens.has(token)) {
        return true
      }
    }
    if (this.tokenCount >= MAX_HELD_PRODUCER_PAUSE_TOKENS) {
      return false
    }
    if (current) {
      current.tokens.add(token)
    } else {
      this.pauses.set(id, { incarnationId, tokens: new Set([token]) })
      this.deps.pause(id)
    }
    this.tokenCount += 1
    return true
  }

  private release(id: string, incarnationId: string, token: string): boolean {
    const current = this.pauses.get(id)
    if (!current) {
      return true
    }
    if (current.incarnationId !== incarnationId || !current.tokens.delete(token)) {
      return current.incarnationId === incarnationId
    }
    this.tokenCount -= 1
    if (current.tokens.size === 0) {
      this.pauses.delete(id)
      this.deps.resume(id)
    }
    return true
  }
}
