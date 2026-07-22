import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'

export function getAgentRowConversationNamesTitle(): string {
  return translate(
    'auto.components.settings.agent-row-conversation-name-copy.title',
    'Label agent rows with conversation names'
  )
}

export function getAgentRowConversationNamesDescription(): string {
  return translate(
    'auto.components.settings.agent-row-conversation-name-copy.description',
    'Show conversation names on sidebar and dashboard agent rows instead of the last message. Rows without a usable name keep the last message.'
  )
}

export function getAgentRowConversationNamesSearchKeywords(): string[] {
  return searchKeywords([
    { key: 'auto.components.settings.agents.search.96ba2373b6', fallback: 'agent' },
    { key: 'auto.components.settings.agents.search.conversation', fallback: 'conversation' },
    { key: 'auto.components.settings.agents.search.966890236d', fallback: 'name' },
    {
      key: 'auto.components.settings.agents.search.conversationName',
      fallback: 'conversation name'
    },
    { key: 'auto.components.settings.agents.search.sidebar', fallback: 'sidebar' },
    { key: 'auto.components.settings.agents.search.dashboard', fallback: 'dashboard' },
    { key: 'auto.components.settings.agents.search.activityRow', fallback: 'activity' },
    { key: 'auto.components.settings.agents.search.lastMessage', fallback: 'last message' },
    { key: 'auto.components.settings.agents.search.c64059f50d', fallback: 'prompt' },
    { key: 'auto.components.settings.agents.search.5784ae8c43', fallback: 'rename' },
    { key: 'auto.components.settings.agents.search.rowLabel', fallback: 'label' }
  ])
}
