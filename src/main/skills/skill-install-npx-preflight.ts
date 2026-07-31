import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { isCommandOnPath } from '../ipc/preflight-command-exec'
import {
  getPreflightWslTarget,
  type PreflightRuntimeContext
} from '../ipc/preflight-runtime-target'
import { mergePersistedWindowsPathAsync } from '../pty/windows-environment-path'
import { hydrateShellPath, mergePathSegments } from '../startup/hydrate-shell-path'

export async function isNpxOnPathForSkillInstall(
  context?: PreflightRuntimeContext,
  options?: { forceRefresh?: boolean }
): Promise<boolean> {
  const wslTarget = getPreflightWslTarget(context) ?? undefined
  await (options?.forceRefresh && !wslTarget
    ? refreshHostPath()
    : hydrateShellPathForAgentDetection(context))
  return isCommandOnPath('npx', wslTarget)
}

async function refreshHostPath(): Promise<void> {
  if (process.platform === 'win32') {
    await mergePersistedWindowsPathAsync(process.env, { forceRefresh: true })
    return
  }
  const hydration = await hydrateShellPath({ force: true })
  if (hydration.ok) {
    mergePathSegments(hydration.segments)
  }
}
