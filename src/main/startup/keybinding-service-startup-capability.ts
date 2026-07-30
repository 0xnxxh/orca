import { KeybindingService, type KeybindingServiceOptions } from '../keybindings/keybinding-service'

export function createKeybindingServiceStartupCapability(
  options: KeybindingServiceOptions
): KeybindingService {
  return new KeybindingService(options)
}
