import type { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import {
  TERMINAL_AUTHORITY_ACQUIRE_WORKTREE_REMOVAL_METHOD,
  TERMINAL_AUTHORITY_CONFIGURE_GRACE_TIME_METHOD,
  TERMINAL_AUTHORITY_RELEASE_WORKTREE_REMOVAL_METHOD,
  assertGraceTimeApplied,
  assertWorktreeRemovalLeaseResult
} from './terminal-authority-control-protocol'

export class TerminalAuthorityControlClient {
  private nextWorktreeRemovalLease = 1

  constructor(private readonly authorityMux: SshChannelMultiplexer) {}

  async configureGraceTime(graceTimeSeconds: number): Promise<{ graceTimeMs: number }> {
    await this.request(
      TERMINAL_AUTHORITY_CONFIGURE_GRACE_TIME_METHOD,
      { graceTimeSeconds },
      (value) => assertGraceTimeApplied(value, graceTimeSeconds)
    )
    return { graceTimeMs: graceTimeSeconds * 1_000 }
  }

  async acquireWorktreeRemoval(rootPath: string): Promise<() => Promise<void>> {
    const leaseToken = `control-${this.nextWorktreeRemovalLease++}`
    const params = { leaseToken, rootPath }
    await this.request(TERMINAL_AUTHORITY_ACQUIRE_WORKTREE_REMOVAL_METHOD, params, (value) =>
      assertWorktreeRemovalLeaseResult(value, leaseToken)
    )
    let release: Promise<void> | null = null
    return () => {
      release ??= this.request(
        TERMINAL_AUTHORITY_RELEASE_WORKTREE_REMOVAL_METHOD,
        params,
        (value) => assertWorktreeRemovalLeaseResult(value, leaseToken)
      ).then(() => {})
      return release
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    validate: (result: unknown) => void
  ): Promise<unknown> {
    try {
      const result = await this.authorityMux.request(method, params)
      validate(result)
      return result
    } catch (error) {
      this.authorityMux.dispose('connection_lost')
      throw new Error(
        `Terminal authority control request failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
