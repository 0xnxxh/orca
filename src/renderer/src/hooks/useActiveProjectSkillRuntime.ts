import { useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import type { SkillDiscoveryTarget } from '../../../shared/skills'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  getProjectAgentSkillRuntime,
  getProjectAgentSkillTerminalShellOverride,
  getProjectSkillDiscoveryTarget,
  getProjectSkillInstallDisabledReason,
  type ProjectAgentSkillRuntime
} from '@/lib/project-skill-runtime'
import { useWindowsTerminalCapabilities } from '@/lib/windows-terminal-capabilities'
import { useAppStore } from '@/store'

type ActiveProjectSkillRuntime = {
  projectRuntime?: ProjectExecutionRuntimeResolution
  discoveryTarget?: SkillDiscoveryTarget
  agentRuntime?: ProjectAgentSkillRuntime
  terminalShellOverride?: string
  installDisabledReason: string | null
}

const EMPTY_ACTIVE_PROJECT_SKILL_RUNTIME: ActiveProjectSkillRuntime = Object.freeze({
  installDisabledReason: null
})

// Why: on Windows the runtime resolution is rebuilt from scratch on every
// worktree-store change, so a same-runtime result still arrives with a fresh
// identity. Downstream skill discovery keys effects off `discoveryTarget`, so
// that churn would re-run a scan (and blink its loading state) per store update.
// Serializing the whole value (rather than picking fields) keeps the comparison
// honest if the resolution grows a field the runtime cache keys do not encode.
function activeProjectSkillRuntimeIdentity(runtime: ActiveProjectSkillRuntime): string {
  return JSON.stringify(runtime)
}

export function useActiveProjectSkillRuntime(): ActiveProjectSkillRuntime {
  const runtimeState = useAppStore(
    useShallow((state) => ({
      activeRepoId: state.activeRepoId,
      activeWorktreeId: state.activeWorktreeId,
      projects: state.projects,
      repos: state.repos,
      settings: state.settings,
      worktreesByRepo: state.worktreesByRepo
    }))
  )
  const currentPlatform = getCurrentPlatform()
  const windowsCapabilities = useWindowsTerminalCapabilities(currentPlatform === 'win32')

  const resolved = useMemo(() => {
    const projectRuntime = getLocalProjectExecutionRuntimeContext(
      runtimeState,
      undefined,
      currentPlatform,
      {
        wslAvailable: windowsCapabilities.isLoading ? undefined : windowsCapabilities.wslAvailable,
        availableWslDistros: windowsCapabilities.isLoading ? null : windowsCapabilities.wslDistros
      }
    )
    if (!projectRuntime) {
      return EMPTY_ACTIVE_PROJECT_SKILL_RUNTIME
    }

    const agentRuntime = getProjectAgentSkillRuntime(projectRuntime, currentPlatform)
    return {
      projectRuntime,
      discoveryTarget: getProjectSkillDiscoveryTarget(projectRuntime),
      agentRuntime,
      terminalShellOverride: getProjectAgentSkillTerminalShellOverride(
        currentPlatform,
        runtimeState.settings,
        agentRuntime
      ),
      installDisabledReason: getProjectSkillInstallDisabledReason(projectRuntime)
    }
  }, [currentPlatform, runtimeState, windowsCapabilities])

  const stableRef = useRef(resolved)
  if (
    activeProjectSkillRuntimeIdentity(stableRef.current) !==
    activeProjectSkillRuntimeIdentity(resolved)
  ) {
    stableRef.current = resolved
  }
  return stableRef.current
}

function getCurrentPlatform(): NodeJS.Platform {
  const platform =
    typeof window === 'undefined' ? undefined : window.api?.platform?.get?.()?.platform
  if (platform) {
    return platform
  }

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (userAgent.includes('Windows')) {
    return 'win32'
  }
  if (userAgent.includes('Mac')) {
    return 'darwin'
  }
  return 'linux'
}
