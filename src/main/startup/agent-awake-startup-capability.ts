import { AgentAwakeService } from '../agent-awake-service'

export async function createAgentAwakeStartupCapability(): Promise<AgentAwakeService> {
  const service = new AgentAwakeService()
  // Why: disk-hydrated rows are UI continuity; only this runtime's hook events prevent sleep.
  service.setStatuses([])
  return service
}
