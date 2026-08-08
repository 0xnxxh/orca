import { runBestEffortAgentBackgroundCleanups } from './agent-background-session-cleanup'

export async function cleanupFailedAgentBackgroundSession(args: {
  releaseTerminalOwnership: () => void
  unsubscribeExit: () => void
  unsubscribeData: () => void
  disposeEagerPtyBuffer: () => void
  clearStartupDelivery: () => void
  clearAgentLaunchConfig: () => void
  clearTabPtyId?: () => void
  retireProvider: () => Promise<void>
  closeCreatedTab?: () => void
}): Promise<void> {
  runBestEffortAgentBackgroundCleanups(args.releaseTerminalOwnership)
  runBestEffortAgentBackgroundCleanups(args.unsubscribeExit, args.unsubscribeData)
  runBestEffortAgentBackgroundCleanups(args.disposeEagerPtyBuffer)
  runBestEffortAgentBackgroundCleanups(args.clearStartupDelivery)
  runBestEffortAgentBackgroundCleanups(args.clearTabPtyId ?? (() => {}))
  runBestEffortAgentBackgroundCleanups(args.clearAgentLaunchConfig)
  await args.retireProvider()
  runBestEffortAgentBackgroundCleanups(args.closeCreatedTab ?? (() => {}))
}
