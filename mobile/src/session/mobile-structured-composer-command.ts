import { getVerifiedNativeChatCommands } from '../../../src/shared/native-chat-agent-profiles'
import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'
import type { MobileStructuredAgent } from './mobile-structured-session-create'

const MODEL_COMMAND: SlashCommandSuggestion = {
  name: 'model',
  description: 'Choose the model'
}
const EFFORT_COMMAND: SlashCommandSuggestion = {
  name: 'effort',
  description: 'Choose reasoning effort'
}

export function mobileStructuredSlashCommands(
  agent: MobileStructuredAgent
): readonly SlashCommandSuggestion[] {
  return [
    MODEL_COMMAND,
    EFFORT_COMMAND,
    ...getVerifiedNativeChatCommands(agent).filter(
      (command) => command.name !== 'model' && command.name !== 'effort'
    )
  ]
}

export type MobileStructuredCommandOutcome = {
  handled: boolean
  accepted: boolean
  error: string | null
}

function commandParts(text: string): { name: string; argument: string } | null {
  if (!text.startsWith('/')) {
    return null
  }
  const match = /^\/([^\s]+)(?:\s+(.*))?$/.exec(text.trimEnd())
  return match ? { name: match[1]!.toLowerCase(), argument: match[2]?.trim() ?? '' } : null
}

export function isMobileStructuredComposerCommand(
  text: string,
  agent: MobileStructuredAgent
): boolean {
  const command = commandParts(text)
  return Boolean(
    command && mobileStructuredSlashCommands(agent).some((entry) => entry.name === command.name)
  )
}

function unavailable(name: string): MobileStructuredCommandOutcome {
  return {
    handled: true,
    accepted: true,
    error: `/${name} is not available in chat sessions.`
  }
}

export async function dispatchMobileStructuredComposerCommand(
  text: string,
  controller: MobileNativeChatSessionOptionsController,
  agent: MobileStructuredAgent
): Promise<MobileStructuredCommandOutcome> {
  const command = commandParts(text)
  if (!command || !isMobileStructuredComposerCommand(text, agent)) {
    return { handled: false, accepted: false, error: null }
  }
  if (command.name !== 'model' && command.name !== 'effort') {
    return unavailable(command.name)
  }
  const descriptor = controller.snapshot.find((entry) => entry.id === command.name)
  if (!descriptor || descriptor.kind.type !== 'select') {
    return {
      handled: true,
      accepted: true,
      error: `${command.name === 'model' ? 'Models' : 'Reasoning effort'} are unavailable for this chat session.`
    }
  }
  if (!command.argument) {
    const opened = await controller.invokeAction(command.name)
    return {
      handled: true,
      accepted: opened,
      error: opened ? null : `Could not open the ${command.name} picker.`
    }
  }
  const normalized = command.argument.toLowerCase()
  const choice = descriptor.kind.choices.find(
    (entry) => entry.value.toLowerCase() === normalized || entry.label.toLowerCase() === normalized
  )
  if (!choice) {
    return {
      handled: true,
      accepted: false,
      error: `${command.argument} is not an available ${command.name} for this chat session.`
    }
  }
  const applied = await controller.setOption(command.name, choice.value)
  return {
    handled: true,
    accepted: applied,
    error: applied ? null : `Could not apply ${command.name} ${choice.label}.`
  }
}
