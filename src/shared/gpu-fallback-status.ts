/** `user` = asked for in Settings and standing until revoked; `automatic` = derived from repeated crashes. */
export type GpuFallbackSource = 'automatic' | 'user'

/** Whether this launch booted in Safe Graphics Mode (hardware acceleration disabled). */
export type GpuFallbackStatus = {
  active: boolean
  /**
   * Epoch ms the active downgrade began, null when hardware acceleration is on.
   * Identity of the engagement: a dismissed notice returns when a new one starts.
   */
  engagedAt: number | null
  /**
   * Whether the persisted decision still applies to the next launch — an automatic
   * engagement or an explicit pin. Diverges from `active` between a Settings change
   * and the relaunch that carries it out.
   */
  enabledForNextLaunch: boolean
  /**
   * Who decided, null when Safe Graphics Mode is neither on nor pending. The renderer must
   * not tell a user who pinned this that a crash caused it — that contradicts the dialog
   * they just accepted and teaches them to distrust the notice where it is true.
   */
  source: GpuFallbackSource | null
}
