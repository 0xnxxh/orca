import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { isCommandOnPath } from '../ipc/preflight-command-exec'
import {
  getPreflightWslTarget,
  type PreflightRuntimeContext
} from '../ipc/preflight-runtime-target'

export async function isNpxOnPathForSkillInstall(
  context?: PreflightRuntimeContext
): Promise<boolean> {
  // Why: cold GUI launches need login-shell hydration to find nvm/brew-managed Node.
  await hydrateShellPathForAgentDetection(context)
  return isCommandOnPath('npx', getPreflightWslTarget(context) ?? undefined)
}
