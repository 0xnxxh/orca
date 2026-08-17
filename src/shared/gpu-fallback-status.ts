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
}
