import { useEffect, useRef } from 'react'
import { getActiveOptionId, type ActiveOption } from './tab-create-entry-active-option'

type NetworkSelectionArgs = {
  activeOptions: ActiveOption[]
  fileIndexReady: boolean
  forcedSearch: boolean
  menuOpen: boolean
  pinnedOptionId: string | null
  query: string
}

export function useNetworkSafeTabEntrySelection({
  activeOptions,
  fileIndexReady,
  forcedSearch,
  menuOpen,
  pinnedOptionId,
  query
}: NetworkSelectionArgs): {
  activeSelectedIndex: number | null
  selectedActiveOption: ActiveOption | undefined
} {
  const pinnedOptionIndex = pinnedOptionId
    ? activeOptions.findIndex((option) => getActiveOptionId(option) === pinnedOptionId)
    : -1
  const rankedOption = pinnedOptionIndex < 0 ? activeOptions[0] : undefined
  const rankedNetworkAction =
    !forcedSearch &&
    rankedOption?.kind === 'entry' &&
    (rankedOption.option.classification.kind === 'search' ||
      rankedOption.option.classification.kind === 'host-url')
  const rankingKey = `${menuOpen}:${query}`
  const blockedNetworkRankingRef = useRef<string | null>(null)
  useEffect(() => {
    if (fileIndexReady && rankedOption && !rankedNetworkAction) {
      blockedNetworkRankingRef.current = rankingKey
    }
  }, [fileIndexReady, rankedNetworkAction, rankedOption, rankingKey])
  const networkActionAllowed = fileIndexReady && blockedNetworkRankingRef.current !== rankingKey
  const activeSelectedIndex =
    pinnedOptionIndex >= 0
      ? pinnedOptionIndex
      : activeOptions.length === 0 || (rankedNetworkAction && !networkActionAllowed)
        ? null
        : 0
  return {
    activeSelectedIndex,
    selectedActiveOption:
      activeSelectedIndex === null ? undefined : activeOptions[activeSelectedIndex]
  }
}
