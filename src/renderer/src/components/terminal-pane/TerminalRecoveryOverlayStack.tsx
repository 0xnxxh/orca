import type { TerminalLegacyRecoveryNotice } from './terminal-legacy-recovery-view-model'
import { TerminalLegacyRecoveryBanner } from './TerminalLegacyRecoveryBanner'
import {
  TerminalSshReconnectOverlay,
  type TerminalSshReconnectOverlayProps
} from './TerminalSshReconnectOverlay'

const STACKED_BANNER_CLASS = 'relative inset-x-auto bottom-auto z-auto w-full'

export type TerminalRecoveryOverlayStackProps = Readonly<{
  legacyRecoveries: readonly TerminalLegacyRecoveryNotice[]
  sshReconnect: Omit<TerminalSshReconnectOverlayProps, 'rootClassName'> | null
}>

export function TerminalRecoveryOverlayStack({
  legacyRecoveries,
  sshReconnect
}: TerminalRecoveryOverlayStackProps): React.JSX.Element | null {
  const hasUnresolvedLegacyRecovery = legacyRecoveries.some(
    (recovery) => recovery.status === 'unresolved'
  )
  if (!hasUnresolvedLegacyRecovery && !sshReconnect) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-3 z-40 flex flex-col items-center gap-2"
      data-terminal-recovery-overlay-stack
    >
      {hasUnresolvedLegacyRecovery ? (
        <TerminalLegacyRecoveryBanner
          recoveries={legacyRecoveries}
          rootClassName={STACKED_BANNER_CLASS}
        />
      ) : null}
      {sshReconnect ? (
        <TerminalSshReconnectOverlay {...sshReconnect} rootClassName={STACKED_BANNER_CLASS} />
      ) : null}
    </div>
  )
}
