export class LegacyPhysicalWorkerLifecycleSignal {
  private listener: (() => void) | null = null

  subscribe(listener: () => void): () => void {
    if (this.listener && this.listener !== listener) {
      throw new Error('legacy physical worker lifecycle listener is already registered')
    }
    this.listener = listener
    return () => {
      if (this.listener === listener) {
        this.listener = null
      }
    }
  }

  notify(): void {
    try {
      this.listener?.()
    } catch {
      /* Registry state remains authoritative. */
    }
  }

  clear(): void {
    this.listener = null
  }
}
