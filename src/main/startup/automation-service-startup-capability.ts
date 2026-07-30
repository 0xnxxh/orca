import { AutomationService } from '../automations/service'

type AutomationServiceParameters = ConstructorParameters<typeof AutomationService>

export function createAutomationServiceStartupCapability(
  store: AutomationServiceParameters[0],
  options: NonNullable<AutomationServiceParameters[1]>
): AutomationService {
  return new AutomationService(store, options)
}
