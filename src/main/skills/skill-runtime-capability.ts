import { SKILL_MANAGEMENT_CAPABILITY } from '../../shared/skill-install-capability'
import { getRuntimeEnvironmentStatus } from '../ipc/runtime-environment-transport-routing'

export async function supportsSkillRuntimeManagement(
  userDataPath: string,
  environmentId: string
): Promise<boolean> {
  const status = await getRuntimeEnvironmentStatus(userDataPath, environmentId, 15_000)
  return (
    status.ok === true && status.result.capabilities?.includes(SKILL_MANAGEMENT_CAPABILITY) === true
  )
}
