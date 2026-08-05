import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { X } from 'lucide-react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import {
  mobileModelPillLabel,
  mobileOptionsPillLabel,
  mobileOptionsPillTitle,
  mobileSessionOptionDisabledReason
} from './mobile-native-chat-session-option-labels'
import { DescriptorRows, Pill, SessionOptionCaption } from './MobileNativeChatSessionOptionRows'
import { sortNativeChatSessionOptions } from '../../../src/shared/native-chat-session-option-snapshot'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

export type MobileNativeChatSessionOptionPickersProps = {
  controller: MobileNativeChatSessionOptionsController
  /** Pickers lock while the agent works — a mid-turn `/model` interleaves with
   *  the agent's own output (desktop parity). */
  isWorking: boolean
  /** A composer send owns the TUI input line until it settles. The host spaces a
   *  send's body and its Enter ~500ms apart, so an apply dispatched inside that
   *  window would be submitted as part of the user's prompt. The composer blocks
   *  the reverse direction on `pendingId`; this is the same guard mirrored. */
  sendInFlight?: boolean
}

/** Model + session-option pills for the chat composer, opening an inline card
 *  of choices (the Ask-card pattern) instead of desktop's dropdown menus. */
export function MobileNativeChatSessionOptionPickers({
  controller,
  isWorking,
  sendInFlight = false
}: MobileNativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const [open, setOpen] = useState<'model' | 'options' | null>(null)
  const { snapshot, pendingId } = controller
  const model = snapshot.find((descriptor) => descriptor.category === 'model')
  const options = sortNativeChatSessionOptions(snapshot)
  if (!model) {
    return null
  }
  const disabled = isWorking || pendingId !== null || sendInFlight
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
              accessibilityRole="button"
              style={styles.sheetClose}
              onPress={() => setOpen(null)}
              hitSlop={8}
            >
              <X size={16} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          </View>
          {dispatched ? (
            <SessionOptionCaption>Sent to the agent — not confirmed</SessionOptionCaption>
          ) : null}
          {reason ? <SessionOptionCaption>{reason}</SessionOptionCaption> : null}
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
  }
})
