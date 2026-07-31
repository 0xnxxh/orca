import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

const PENDING_REVIEW_STORAGE_KEY = 'orca.dashboard.rings.pending-review-pane-keys'
const PINNED_STORAGE_KEY = 'orca.dashboard.rings.pinned-pane-keys'
const MAX_STORED_PANE_KEYS = 500

function readStoredPaneKeys(key: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(stored)) {
      return new Set()
    }
    const paneKeys: string[] = []
    for (
      let index = stored.length - 1;
      index >= 0 && paneKeys.length < MAX_STORED_PANE_KEYS;
      index--
    ) {
      const value = stored[index]
      if (typeof value === 'string') {
        paneKeys.push(value)
      }
    }
    paneKeys.reverse()
    return new Set(paneKeys)
  } catch {
    return new Set()
  }
}

function storePaneKeys(key: string, paneKeys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...paneKeys].slice(-MAX_STORED_PANE_KEYS)))
  } catch {
    // Dashboard state still works for the current mount when storage is unavailable.
  }
}

function addStoredPaneKey(current: ReadonlySet<string>, paneKey: string): Set<string> {
  if (current.has(paneKey)) {
    return current as Set<string>
  }
  const next = new Set(current)
  next.add(paneKey)
  while (next.size > MAX_STORED_PANE_KEYS) {
    next.delete(next.values().next().value!)
  }
  return next
}

function removePaneKeys(current: ReadonlySet<string>, paneKeys: ReadonlySet<string>): Set<string> {
  let changed = false
  for (const paneKey of paneKeys) {
    if (current.has(paneKey)) {
      changed = true
      break
    }
  }
  if (!changed) {
    return current as Set<string>
  }
  const next = new Set<string>()
  for (const paneKey of current) {
    if (!paneKeys.has(paneKey)) {
      next.add(paneKey)
    }
  }
  return next
}

export function useFleetResultDisposition(
  cards: DashboardCard[],
  onAckAgent: (paneKey: string) => void
): {
  reviewedPaneKeys: ReadonlySet<string>
  pinnedPaneKeys: ReadonlySet<string>
  acknowledge: (card: DashboardCard) => void
  markReviewed: (cards: DashboardCard[]) => void
  togglePinned: (card: DashboardCard) => void
} {
  const [explicitlyReviewed, setExplicitlyReviewed] = useState<Set<string>>(() => new Set())
  const [keptForReview, setKeptForReview] = useState<Set<string>>(() =>
    readStoredPaneKeys(PENDING_REVIEW_STORAGE_KEY)
  )
  const [pinnedPaneKeys, setPinnedPaneKeys] = useState<Set<string>>(() =>
    readStoredPaneKeys(PINNED_STORAGE_KEY)
  )
  const reviewedPaneKeys = useMemo(() => {
    const reviewed = new Set<string>()
    for (const card of cards) {
      if (explicitlyReviewed.has(card.paneKey)) {
        reviewed.add(card.paneKey)
      }
      if (card.dotState === 'done' && !card.unseen && !keptForReview.has(card.paneKey)) {
        reviewed.add(card.paneKey)
      }
    }
    return reviewed
  }, [cards, explicitlyReviewed, keptForReview])

  useEffect(() => {
    storePaneKeys(PENDING_REVIEW_STORAGE_KEY, keptForReview)
  }, [keptForReview])

  useEffect(() => {
    storePaneKeys(PINNED_STORAGE_KEY, pinnedPaneKeys)
  }, [pinnedPaneKeys])

  const acknowledge = useCallback(
    (card: DashboardCard): void => {
      if (card.dotState === 'done' && card.unseen) {
        setKeptForReview((current) => addStoredPaneKey(current, card.paneKey))
      }
      onAckAgent(card.paneKey)
    },
    [onAckAgent]
  )

  const markReviewed = useCallback(
    (reviewedCards: DashboardCard[]): void => {
      const paneKeys = new Set<string>()
      for (const card of reviewedCards) {
        paneKeys.add(card.paneKey)
      }
      const activePaneKeys = new Set<string>()
      for (const card of cards) {
        activePaneKeys.add(card.paneKey)
      }
      setExplicitlyReviewed((current) => {
        const next = new Set<string>()
        for (const paneKey of current) {
          if (activePaneKeys.has(paneKey)) {
            next.add(paneKey)
          }
        }
        for (const paneKey of paneKeys) {
          if (activePaneKeys.has(paneKey)) {
            next.add(paneKey)
          }
        }
        return next
      })
      setKeptForReview((current) => removePaneKeys(current, paneKeys))
      for (const card of reviewedCards) {
        onAckAgent(card.paneKey)
      }
    },
    [cards, onAckAgent]
  )

  const togglePinned = useCallback((card: DashboardCard): void => {
    setPinnedPaneKeys((current) => {
      if (!current.has(card.paneKey)) {
        return addStoredPaneKey(current, card.paneKey)
      }
      const next = new Set(current)
      next.delete(card.paneKey)
      return next
    })
  }, [])

  return {
    reviewedPaneKeys,
    pinnedPaneKeys,
    acknowledge,
    markReviewed,
    togglePinned
  }
}
