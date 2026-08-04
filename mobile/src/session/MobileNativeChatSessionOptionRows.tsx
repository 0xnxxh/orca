// The pill and choice-row primitives the session-option card is built from, kept
// beside it so the card file stays about layout and apply wiring.

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Check, ChevronDown } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'

/** Muted one-liner above a group — dispatch state, or why a row is locked. */
export function SessionOptionCaption({ children }: { children: string }): React.JSX.Element {
  return <Text style={styles.caption}>{children}</Text>
}

export function Pill({
  label,
  accessibleName,
  disabled,
  onPress
}: {
  label: string
  accessibleName: string
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibleName}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.pill, pressed && !disabled && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      <Text
        style={[styles.pillText, disabled && styles.pillTextDisabled]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <ChevronDown size={12} color={disabled ? colors.textMuted : colors.textSecondary} />
    </Pressable>
  )
}

function ChoiceRow({
  label,
  description,
  selected,
  disabled,
  onPress
}: {
  label: string
  description?: string
  selected: boolean
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[styles.row, selected && styles.rowSelected, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <Check size={12} color={colors.bgBase} strokeWidth={3} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? (
          <Text style={styles.rowDescription} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

function ActionRow({
  label,
  disabled,
  onPress
}: {
  label: string
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
    </Pressable>
  )
}

export function DescriptorRows({
  descriptor,
  disabled,
  onSetOption,
  onInvokeAction
}: {
  descriptor: SessionOptionDescriptor
  disabled: boolean
  onSetOption: (value: SessionOptionValue) => void
  onInvokeAction: () => void
}): React.JSX.Element {
  const locked = disabled || !descriptor.settable
  // Why: flip-only without a baseline is an action — never claim On/Off.
  if (descriptor.action?.type === 'toggle-command') {
    return (
      <ActionRow
        label={`Toggle ${descriptor.label.toLowerCase()}`}
        disabled={locked}
        onPress={onInvokeAction}
      />
    )
  }
  // Why: agent-picker opens the TUI; it is not a set of radio choices.
  if (descriptor.action?.type === 'agent-picker') {
    return <ActionRow label="Choose in agent picker…" disabled={locked} onPress={onInvokeAction} />
  }
  // Unknown booleans leave both radios unselected instead of inventing truth.
  if (descriptor.kind.type === 'boolean') {
    const current = descriptor.kind.currentValue
    return (
      <>
        {current === undefined ? (
          <SessionOptionCaption>Current value unknown — pick On or Off</SessionOptionCaption>
        ) : null}
        <ChoiceRow
          label="On"
          selected={current === true}
          disabled={locked}
          onPress={() => onSetOption(true)}
        />
        <ChoiceRow
          label="Off"
          selected={current === false}
          disabled={locked}
          onPress={() => onSetOption(false)}
        />
      </>
    )
  }
  const { currentValue, choices } = descriptor.kind
  return (
    <>
      {choices.map((choice) => (
        <ChoiceRow
          key={choice.value}
          label={choice.label}
          description={choice.description}
          selected={choice.value === currentValue}
          disabled={locked}
          onPress={() => onSetOption(choice.value)}
        />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 180,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgRaised
  },
  pillText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600',
    flexShrink: 1
  },
  pillTextDisabled: {
    color: colors.textMuted
  },
  pressed: {
    opacity: 0.7
  },
  caption: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    borderRadius: radii.card,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.xs
  },
  rowSelected: {
    borderColor: colors.statusGreen
  },
  rowDisabled: {
    opacity: 0.5
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center'
  },
  radioOn: {
    backgroundColor: colors.statusGreen,
    borderColor: colors.statusGreen
  },
  rowBody: {
    flex: 1,
    gap: 2
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  rowDescription: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  }
})
