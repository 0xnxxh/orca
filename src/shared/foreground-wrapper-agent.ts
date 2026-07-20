import {
  recognizeAgentProcessFromCommandLine,
  type RecognizedAgentProcess
} from './agent-process-recognition'
import { getSyntheticAgentTitleProfile } from './synthetic-agent-title'

export type ForegroundAgentCandidate = { command: string; depth: number }

/**
 * Collapse a foreground read onto the OUTER wrapper when one agent embeds
 * another of the same title-identity group. OMP runs as `shell → omp → pi` and
 * both are recognized agents, so the deepest-foreground scan otherwise returns
 * the wrapped `pi` child — but `omp` is the agent the user launched and sees.
 * Given the reader's recognized winner plus every descendant, return the
 * shallowest same-group agent (the wrapper). Un-nested or cross-group reads
 * (bare Pi, Codex, etc.) are returned unchanged, and the result is stable
 * regardless of which of omp/pi holds the terminal foreground at the sampled
 * instant — which is what stops the OMP↔Pi tab-icon flicker at its source.
 */
export function resolveOuterWrapperForegroundProcess(
  winner: RecognizedAgentProcess,
  winnerDepth: number,
  descendants: readonly ForegroundAgentCandidate[]
): string {
  const winnerGroup = getSyntheticAgentTitleProfile(winner.agent)?.titleIdentityGroup
  if (!winnerGroup) {
    return winner.processName
  }
  let outerProcessName = winner.processName
  let outerDepth = winnerDepth
  for (const candidate of descendants) {
    if (candidate.depth >= outerDepth) {
      continue
    }
    const recognized = recognizeAgentProcessFromCommandLine(candidate.command)
    if (!recognized) {
      continue
    }
    if (getSyntheticAgentTitleProfile(recognized.agent)?.titleIdentityGroup === winnerGroup) {
      outerProcessName = recognized.processName
      outerDepth = candidate.depth
    }
  }
  return outerProcessName
}
