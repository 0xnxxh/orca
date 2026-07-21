import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { SmartWorkspaceSourceRow as SourceRow } from '../../../src/shared/new-workspace/smart-workspace-source-results'
import {
  MR_STATE_FILTER_OPTIONS,
  resolveAvailableSmartModes,
  resolveDefaultSmartMode,
  SMART_MODE_OPTIONS,
  type SmartModeAvailabilityInput,
  type SmartModeOption
} from '../tasks/mobile-smart-source-modes'
import type { MrStateFilter, SmartNameMode } from '../tasks/mobile-composer-source-types'
import {
  lookupGitHubItemByOwnerRepo,
  type PasteRepoCandidate
} from '../tasks/smart-source-paste-intent'
import { useSmartWorkspaceSource } from '../tasks/use-smart-workspace-source'
import type { MobileComposerSource } from '../tasks/use-mobile-composer-source'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { BottomDrawer, BOTTOM_DRAWER_HIDE_DURATION_MS } from './BottomDrawer'
import { SmartCrossRepoSourcePrompt } from './SmartCrossRepoSourcePrompt'
import { SmartSourceModeIcon } from './SmartSourceModeIcon'
import { SmartLinearLinkResolutionStatus } from './SmartLinearLinkResolutionStatus'
import { SmartWorkspaceSourceRow } from './SmartWorkspaceSourceRow'

type Props = {
  visible: boolean
  client: RpcClient | null
  composer: MobileComposerSource
  availability: SmartModeAvailabilityInput
  repoId: string | null
  repos: readonly PasteRepoCandidate[]
  linearWorkspaceId?: string | null
  sshReady: boolean
  onRepoChange: (repoId: string) => void
  onClose: () => void
}

export function SmartWorkspaceSourceDrawer({
  visible,
  client,
  composer,
  availability,
  repoId,
  repos,
  linearWorkspaceId,
  sshReady,
  onRepoChange,
  onClose
}: Props) {
  const availableModes = useMemo(() => resolveAvailableSmartModes(availability), [availability])
  const [mode, setMode] = useState<SmartNameMode>(() => resolveDefaultSmartMode(availability))
  const [mrStateFilter, setMrStateFilter] = useState<MrStateFilter>('opened')
  // Why: read latest availability inside the open effect without making it a
  // reactive dep (the object is recreated each render), so re-seeding happens
  // only on open, not on every availability recompute.
  const availabilityRef = useRef(availability)
  availabilityRef.current = availability

  // Reset to the default mode each time the drawer opens.
  useEffect(() => {
    if (visible) {
      setMode(resolveDefaultSmartMode(availabilityRef.current))
    }
  }, [visible])

  // Snap the chosen mode back into the available set if availability changes.
  const effectiveMode = availableModes.includes(mode) ? mode : (availableModes[0] ?? 'text')

  // Linear searches without a repo; every other provider/branch search needs a
  // connected repo-backed target.
  const searchEnabled = visible && (effectiveMode === 'linear' || sshReady)

  const {
    rows,
    loading,
    error,
    needsGitHubRemote,
    emptyHint,
    crossRepoPrompt,
    dismissCrossRepoPrompt,
    linearLinkResolution
  } = useSmartWorkspaceSource({
    client,
    enabled: searchEnabled,
    mode: effectiveMode,
    query: composer.name,
    repoId,
    githubAvailable: availability.githubAvailable,
    gitlabAvailable: availability.gitlabAvailable,
    linearAvailable: availability.linearAvailable,
    mrStateFilter,
    linearWorkspaceId,
    repos
  })

  function closeSoon(): void {
    setTimeout(onClose, BOTTOM_DRAWER_HIDE_DURATION_MS)
  }

  function handleSelectRow(row: SourceRow): void {
    switch (row.kind) {
      case 'use-name':
        composer.setName(row.name)
        break
      case 'create-branch':
        composer.handleSmartCreateBranch(row.name)
        break
      case 'github':
        composer.handleSmartGitHubItemSelect(row.item)
        break
      case 'gitlab':
        composer.handleSmartGitLabItemSelect(row.item)
        break
      case 'branch':
        composer.handleSmartBranchSelect(row.refName, row.localBranchName)
        break
      case 'linear':
        composer.handleSmartLinearIssueSelect(row.issue)
        break
    }
    onClose()
  }

  async function handleAcceptCrossRepo(): Promise<void> {
    if (!client || !crossRepoPrompt) {
      return
    }
    const { link, matchingRepo } = crossRepoPrompt
    try {
      const item = await lookupGitHubItemByOwnerRepo(
        client,
        matchingRepo.id,
        link.slug,
        link.number,
        link.type
      )
      if (item) {
        onRepoChange(matchingRepo.id)
        composer.handleSmartGitHubItemSelect(item)
        onClose()
      }
    } catch {
      dismissCrossRepoPrompt()
    }
  }

  const showEmpty =
    !loading && !error && !needsGitHubRemote && effectiveMode !== 'text' && rows.length === 0

  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      dragContentToDismiss={false}
      contentScrollable={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Name or 'Create From'</Text>
        <Pressable onPress={closeSoon} hitSlop={8}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.search}
        value={composer.name}
        onChangeText={composer.setName}
        placeholder="Type a name or search a source"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />

      <View style={styles.tabRow}>
        {SMART_MODE_OPTIONS.filter((option: SmartModeOption) =>
          availableModes.includes(option.id)
        ).map((option) => {
          const selected = option.id === effectiveMode
          const tint = selected ? colors.textPrimary : colors.textSecondary
          return (
            <Pressable
              key={option.id}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => setMode(option.id)}
            >
              <SmartSourceModeIcon icon={option.icon} color={tint} />
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {effectiveMode === 'gitlab' ? (
        <View style={styles.chipRow}>
          {MR_STATE_FILTER_OPTIONS.map((option) => {
            const selected = option.id === mrStateFilter
            return (
              <Pressable
                key={option.id}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setMrStateFilter(option.id)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {crossRepoPrompt ? (
        <SmartCrossRepoSourcePrompt
          prompt={crossRepoPrompt}
          onDismiss={dismissCrossRepoPrompt}
          onAccept={() => void handleAcceptCrossRepo()}
        />
      ) : null}

      {!sshReady && effectiveMode !== 'text' && effectiveMode !== 'linear' ? (
        <Text style={styles.notice}>Connect the repository to search sources.</Text>
      ) : needsGitHubRemote ? (
        <Text style={styles.notice}>
          This SSH repo needs a GitHub remote to list issues and PRs.
        </Text>
      ) : error ? (
        <Text style={styles.errorNotice}>{error}</Text>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.value}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        ListHeaderComponent={
          <SmartLinearLinkResolutionStatus
            resolution={linearLinkResolution}
            hasSourceResults={rows.some(
              (row) => row.kind !== 'use-name' && row.kind !== 'create-branch'
            )}
          />
        }
        ListFooterComponent={
          loading && linearLinkResolution.status !== 'resolving' ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : showEmpty ? (
            <Text style={styles.empty}>{emptyHint || 'No results found.'}</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <SmartWorkspaceSourceRow row={item} onPress={() => handleSelectRow(item)} />
        )}
      />
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary
  },
  done: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.accentBlue
  },
  search: {
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodySize,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  tabSelected: {
    backgroundColor: colors.bgPanel,
    borderColor: colors.textSecondary
  },
  tabText: {
    fontSize: 13,
    color: colors.textSecondary
  },
  tabTextSelected: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  chipSelected: {
    backgroundColor: colors.bgPanel,
    borderColor: colors.textSecondary
  },
  chipText: {
    fontSize: 12,
    color: colors.textSecondary
  },
  chipTextSelected: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  notice: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  errorNotice: {
    fontSize: 12,
    color: colors.statusRed,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  list: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden',
    maxHeight: 420,
    flexGrow: 0
  },
  loading: {
    paddingVertical: spacing.lg,
    alignItems: 'center'
  },
  empty: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 13
  }
})
