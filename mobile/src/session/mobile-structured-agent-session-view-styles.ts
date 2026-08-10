import { StyleSheet } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  title: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '600',
    textAlign: 'center'
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.bodySize,
    textAlign: 'center',
    marginTop: spacing.sm
  },
  loader: { paddingVertical: spacing.md },
  readOnlyBanner: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center'
  },
  readOnlyText: { color: colors.textMuted, fontSize: typography.metaSize }
})
