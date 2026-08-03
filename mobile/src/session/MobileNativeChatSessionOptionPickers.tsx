import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, ChevronDown, X } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import {
  mobileModelPillLabel,
  mobileOptionsPillLabel,
  mobileOptionsPillTitle,
  mobileSessionOptionDisabledReason,
  sortedMobileSessionOptions
} from './mobile-native-chat-session-option-labels'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

export type MobileNativeChatSessionOptionPickersProps = {
  controller: MobileNativeChatSessionOptionsController
  /** Pickers lock while the agent works — a mid-turn `/model` interleaves with
   *  the agent's own output (desktop parity). */
  isWorking: boolean
}

function Pill({
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

function DescriptorRows({
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
  // Why: absolute On/Off only when we have tracked truth. Unknown composed
  // booleans leave the group unselected so empty radios are not a selection.
  if (descriptor.kind.type === 'boolean') {
    const current = descriptor.kind.currentValue
    return (
      <>
        {current === undefined ? (
          <Text style={styles.caption}>Current value unknown — pick On or Off</Text>
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

/** Model + session-option pills for the chat composer, opening an inline card
 *  of choices (the Ask-card pattern) instead of desktop's dropdown menus. */
export function MobileNativeChatSessionOptionPickers({
  controller,
  isWorking
}: MobileNativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const [open, setOpen] = useState<'model' | 'options' | null>(null)
  const { snapshot, pendingId } = controller
  const model = snapshot.find((descriptor) => descriptor.category === 'model')
  const options = sortedMobileSessionOptions(snapshot)
  if (!model) {
    return null
  }
  const disabled = isWorking || pendingId !== null
  const sheetDescriptors = open === 'model' ? [model] : options
  const sheetTitle = open === 'model' ? 'Model' : mobileOptionsPillTitle(options)
  const dispatched = sheetDescriptors.some((descriptor) => descriptor.valueSource === 'dispatched')
  const reason =
    open !== null
      ? mobileSessionOptionDisabledReason(
          sheetDescriptors.find((descriptor) => !descriptor.settable)?.disabledReason
        )
      : null

  const applyOption = (descriptor: SessionOptionDescriptor, value: SessionOptionValue): void => {
    // Re-picking the tracked value is a no-op — never re-dispatch it.
    if (
      descriptor.valueSource !== 'unknown' &&
      descriptor.kind.type === 'select' &&
      descriptor.kind.currentValue === value
    ) {
      setOpen(null)
      return
    }
    void controller.setOption(descriptor.id, value).then((applied) => {
      if (applied) {
        setOpen(null)
      }
    })
  }
  const invokeAction = (descriptor: SessionOptionDescriptor): void => {
    void controller.invokeAction(descriptor.id).then((invoked) => {
      if (invoked) {
        setOpen(null)
      }
    })
  }

  return (
    <View>
      {open !== null ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{sheetTitle}</Text>
            {pendingId !== null ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : null}
            <Pressable
              accessibilityLabel="Close picker"
              style={styles.sheetClose}
              onPress={() => setOpen(null)}
              hitSlop={8}
            >
              <X size={16} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          </View>
          {dispatched ? (
            <Text style={styles.caption}>Sent to the agent — not confirmed</Text>
          ) : null}
          {reason ? <Text style={styles.caption}>{reason}</Text> : null}
          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="always">
            {sheetDescriptors.map((descriptor, index) => (
              <View key={descriptor.id}>
                {open === 'options' ? (
                  <Text style={[styles.sectionLabel, index > 0 && styles.sectionLabelSpaced]}>
                    {descriptor.label}
                  </Text>
                ) : null}
                <DescriptorRows
                  descriptor={descriptor}
                  disabled={disabled}
                  onSetOption={(value) => applyOption(descriptor, value)}
                  onInvokeAction={() => invokeAction(descriptor)}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.pillRow}>
        <Pill
          label={mobileModelPillLabel(model)}
          accessibleName={`Model, ${mobileModelPillLabel(model)}`}
          disabled={disabled}
          onPress={() => setOpen(open === 'model' ? null : 'model')}
        />
        {options.length > 0 ? (
          <Pill
            label={mobileOptionsPillLabel(options)}
            accessibleName={`${mobileOptionsPillTitle(options)}, ${mobileOptionsPillLabel(options)}`}
            disabled={disabled}
            onPress={() => setOpen(open === 'options' ? null : 'options')}
          />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: colors.bgPanel
  },
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
  sheet: {
    maxHeight: 320,
    backgroundColor: colors.bgPanel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs
  },
  sheetTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  sheetClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sheetScroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    fontWeight: '600',
    marginBottom: spacing.xs
  },
  sectionLabelSpaced: {
    marginTop: spacing.sm
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
