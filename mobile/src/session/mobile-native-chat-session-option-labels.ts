// Mobile port of desktop's pill labeling
// (src/renderer/src/components/native-chat/native-chat-session-option-labels.ts),
// minus i18n — mobile renders plain strings throughout.

import type {
  SessionOptionDescriptor,
  SessionOptionDisabledReason,
  SessionOptionSelectChoice
} from '../../../src/shared/native-chat-session-options'

const CATEGORY_ORDER: Record<string, number> = {
  thought_level: 0,
  model_config: 1,
  mode: 2
}

/** Non-model descriptors in display order (effort before modes, desktop parity). */
export function sortedMobileSessionOptions(
  snapshot: readonly SessionOptionDescriptor[]
): SessionOptionDescriptor[] {
  return snapshot
    .filter((descriptor) => descriptor.category !== 'model')
    .sort((left, right) => {
      const leftOrder = CATEGORY_ORDER[left.category ?? ''] ?? 3
      const rightOrder = CATEGORY_ORDER[right.category ?? ''] ?? 3
      return leftOrder - rightOrder
    })
}

export function mobileSessionOptionDisabledReason(
  reason: SessionOptionDisabledReason | undefined
): string | null {
  // Exhaustive over SessionOptionDisabledReason so new keys are a compile error.
  switch (reason) {
    case 'set-when-session-starts':
      return 'Set when the session starts.'
    case 'available-after-session-start':
      return 'Available after the session starts.'
    case undefined:
      return null
  }
}

function selectedChoiceLabel(descriptor: SessionOptionDescriptor): string | null {
  if (
    descriptor.valueSource === 'unknown' ||
    descriptor.kind.type !== 'select' ||
    !descriptor.kind.currentValue
  ) {
    return null
  }
  const current = descriptor.kind.currentValue
  const choice: SessionOptionSelectChoice = descriptor.kind.choices.find(
    (candidate) => candidate.value === current
  ) ?? { value: current, label: current }
  return choice.label
}

/** Value-only pill text — the category lives on the sheet title, not the pill. */
export function mobileModelPillLabel(descriptor: SessionOptionDescriptor): string {
  return selectedChoiceLabel(descriptor) ?? 'Model'
}

export function mobileOptionsPillTitle(descriptors: readonly SessionOptionDescriptor[]): string {
  const effort = descriptors.find((descriptor) => descriptor.id === 'effort')
  // Why: an effort-backed group is primarily the effort picker, even when it
  // also reports modes.
  return effort ? effort.label : 'Session options'
}

export function mobileOptionsPillLabel(descriptors: readonly SessionOptionDescriptor[]): string {
  const labels: string[] = []
  for (const descriptor of descriptors) {
    if (descriptor.valueSource === 'unknown') {
      continue
    }
    if (descriptor.kind.type === 'select') {
      const label = selectedChoiceLabel(descriptor)
      if (label) {
        labels.push(label)
      }
    } else if (descriptor.kind.currentValue === true) {
      labels.push(descriptor.id === 'fastMode' ? 'Fast' : descriptor.label)
    }
  }
  if (labels.length > 0) {
    return labels.join(' · ')
  }
  const effort = descriptors.find((descriptor) => descriptor.id === 'effort')
  return effort ? effort.label : 'Options'
}
