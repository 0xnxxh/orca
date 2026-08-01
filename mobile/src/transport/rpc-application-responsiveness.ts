const RPC_TIMEOUT_RECYCLE_STREAK = 2

export class RpcApplicationResponsiveness {
  private unresponsiveSince: number | null = null
  private timeoutStreak = 0

  recordResponse(method: string, now = Date.now()): boolean {
    if (isRpcHealthProbeMethod(method)) {
      return false
    }
    return this.recordApplicationResponse(now)
  }

  recordApplicationResponse(_now = Date.now()): boolean {
    const recovered = this.unresponsiveSince !== null
    this.unresponsiveSince = null
    this.timeoutStreak = 0
    return recovered
  }

  recordTimeout(method: string, now = Date.now()): { latched: boolean; recycle: boolean } {
    if (isRpcHealthProbeMethod(method)) {
      return { latched: false, recycle: false }
    }
    this.timeoutStreak += 1
    const latched = this.unresponsiveSince === null
    this.unresponsiveSince ??= now
    return { latched, recycle: this.timeoutStreak >= RPC_TIMEOUT_RECYCLE_STREAK }
  }

  getUnresponsiveSince(): number | null {
    return this.unresponsiveSince
  }
}

export function isRpcHealthProbeMethod(method: string): boolean {
  return method === 'status.get'
}
