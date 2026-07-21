import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SmartCrossRepoPrompt } from '../tasks/use-smart-workspace-source'
import { colors, radii, spacing } from '../theme/mobile-theme'

export function SmartCrossRepoSourcePrompt({
  prompt,
  onDismiss,
  onAccept
}: {
  prompt: SmartCrossRepoPrompt
  onDismiss: () => void
  onAccept: () => void
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        This item lives in {prompt.link.slug.owner}/{prompt.link.slug.repo}.
      </Text>
      <View style={styles.actions}>
        <Pressable style={styles.dismiss} onPress={onDismiss}>
          <Text style={styles.dismissText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.accept} onPress={onAccept}>
          <Text style={styles.acceptText}>Switch to {prompt.matchingRepo.displayName}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgRaised,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm
  },
  text: {
    fontSize: 13,
    color: colors.textSecondary
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm
  },
  dismiss: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  dismissText: {
    fontSize: 13,
    color: colors.textSecondary
  },
  accept: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.textSecondary
  },
  acceptText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary
  }
})
