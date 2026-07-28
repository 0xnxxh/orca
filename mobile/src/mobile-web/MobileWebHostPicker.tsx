import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChevronRight, MonitorSmartphone, RefreshCw } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { mobileWebHostPickerPresentationState } from './mobile-web-shell-presentation-state'

type MobileWebHost = { id: string; name: string; lastConnected: number }

export function MobileWebHostPicker({
  hosts,
  loading,
  failed,
  onRetry,
  onSelect
}: {
  hosts: MobileWebHost[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  onSelect: (hostId: string) => void
}) {
  const presentationState = mobileWebHostPickerPresentationState({
    loading,
    failed,
    hostCount: hosts.length
  })
  if (presentationState === 'loading') {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text accessibilityLiveRegion="polite" style={styles.loadingTitle}>
          Loading paired hosts…
        </Text>
      </View>
    )
  }
  if (presentationState === 'failed' || presentationState === 'empty') {
    return (
      <View style={styles.loadingState}>
        <MonitorSmartphone size={26} color={colors.textMuted} />
        <Text
          accessibilityRole={presentationState === 'failed' ? 'alert' : undefined}
          style={styles.loadingTitle}
        >
          {presentationState === 'failed' ? 'Hosts could not be loaded' : 'No paired hosts'}
        </Text>
        <Text style={styles.loadingBody}>
          {presentationState === 'failed'
            ? 'Try reading the paired host list again.'
            : 'Pair a desktop before opening a workspace.'}
        </Text>
        {presentationState === 'failed' ? (
          <Pressable
            accessibilityLabel="Retry loading paired hosts"
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={onRetry}
          >
            <RefreshCw size={14} color={colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }
  return (
    <ScrollView contentContainerStyle={styles.hostList}>
      <Text style={styles.intro}>
        Choose a paired desktop. Its matching web UI will travel through the authenticated Orca
        connection and remain isolated from native credentials.
      </Text>
      <View style={styles.hostCard}>
        {hosts.map((host, index) => (
          <View key={host.id}>
            {index > 0 ? <View style={styles.separator} /> : null}
            <Pressable
              accessibilityLabel={`Open ${host.name}`}
              accessibilityRole="button"
              style={({ pressed }) => [styles.hostRow, pressed && styles.rowPressed]}
              onPress={() => onSelect(host.id)}
            >
              <MonitorSmartphone size={16} color={colors.textSecondary} />
              <Text numberOfLines={1} style={styles.hostName}>
                {host.name}
              </Text>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl
  },
  loadingTitle: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  loadingBody: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 18,
    textAlign: 'center'
  },
  retryButton: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.md,
    height: 34
  },
  retryText: { color: colors.textPrimary, fontSize: typography.metaSize, fontWeight: '600' },
  hostList: { padding: spacing.lg, paddingBottom: spacing.xl },
  intro: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 18,
    marginBottom: spacing.lg
  },
  hostCard: { backgroundColor: colors.bgPanel, borderRadius: radii.card, overflow: 'hidden' },
  hostRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  hostName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  }
})
