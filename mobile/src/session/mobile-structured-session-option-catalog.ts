import type {
  AgentSessionOptionCatalog,
  CatalogModel,
  CatalogOption
} from '../../../src/shared/agent-session-option-catalog'
import type { AgentSessionOptionsResult } from '../../../src/shared/agent-session-wire'

function effortOption(model: AgentSessionOptionsResult['models'][number]): CatalogOption | null {
  if (model.efforts.length <= 1) {
    return null
  }
  return {
    id: 'effort',
    label: 'Reasoning effort',
    category: 'thought_level',
    kind: {
      type: 'select',
      choices: model.efforts,
      defaultValue: model.defaultEffort ?? model.efforts[0]!.value
    },
    apply: { midSession: { kind: 'command', build: (value) => `/effort ${String(value)}` } }
  }
}

export function mobileStructuredOptionCatalog(
  seed: AgentSessionOptionCatalog,
  result: AgentSessionOptionsResult
): AgentSessionOptionCatalog {
  const models: CatalogModel[] = result.models.map((model) => {
    const effort = effortOption(model)
    return {
      id: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {}),
      ...(model.isDefault ? { isDefault: true } : {}),
      options: effort ? [effort] : []
    }
  })
  return { ...seed, models, defaultModelIsCliDefault: true }
}
