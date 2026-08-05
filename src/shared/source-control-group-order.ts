import type { SourceControlGroupOrder } from './types'

export const DEFAULT_SOURCE_CONTROL_GROUP_ORDER: SourceControlGroupOrder = 'staged-first'

export function normalizeSourceControlGroupOrder(value: unknown): SourceControlGroupOrder {
  return value === 'changes-first' || value === 'staged-first'
    ? value
    : DEFAULT_SOURCE_CONTROL_GROUP_ORDER
}
