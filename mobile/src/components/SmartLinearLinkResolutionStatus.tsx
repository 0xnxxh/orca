import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { SmartLinearLinkResolution } from '../tasks/use-smart-workspace-source'
import { colors, spacing } from '../theme/mobile-theme'

export function SmartLinearLinkResolutionStatus({
  resolution,
  hasSourceResults
}: {
  resolution: SmartLinearLinkResolution
  hasSourceResults: boolean
}) {
  if (resolution.status === 'idle') {
    return null
  }
  if (resolution.status === 'resolved') {
    return (
      <Text accessible accessibilityLiveRegion="polite" style={styles.accessibilityAnnouncement}>
        Linear issue {resolution.identifier} resolved.
      </Text>
    )
  }
  if (resolution.status === 'resolving') {
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.resolution}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={styles.text}>Resolving Linear link…</Text>
      </View>
    )
  }
  return (
    <Text accessibilityLiveRegion="polite" style={styles.text}>
      {hasSourceResults
        ? 'No exact match for this Linear link.'
        : 'Linear issue not found in your connected workspaces.'}
    </Text>
  )
}

const styles = StyleSheet.create({
  accessibilityAnnouncement: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0
  },
  resolution: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md
  },
  text: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textMuted,
    fontSize: 12
  }
})
