import { DesktopRelayService } from '../runtime/relay/desktop-relay-service'

type DesktopRelayServiceParameters = ConstructorParameters<typeof DesktopRelayService>

export function createDesktopRelayServiceStartupCapability(
  options: DesktopRelayServiceParameters[0]
): DesktopRelayService {
  return new DesktopRelayService(options)
}
