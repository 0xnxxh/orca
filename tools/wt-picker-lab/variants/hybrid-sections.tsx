import React from 'react'
import { cn } from '@/lib/utils'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'
import { Hit, type Scored } from './typed-query-matching'

export const SECTIONS = [
  { key: 'recent', heading: 'Recent' },
  { key: 'projects', heading: 'Projects' },
  { key: 'folders', heading: 'Folders' },
  { key: 'results', heading: undefined }
] as const

export type Sections = Record<(typeof SECTIONS)[number]['key'], Scored[]>

/** Below this a list is scannable, so sections are chrome rather than help. */
const SECTION_THRESHOLD = 6
const RECENT_LIMIT = 4

/**
 * While a query is live the ranking *is* the order, so sections would fight it —
 * everything collapses into one unlabelled result list.
 */
export function useSectioned(matches: readonly Scored[], query: string): Sections {
  return React.useMemo(() => {
    const empty: Sections = { recent: [], projects: [], folders: [], results: [] }
    if (query.trim() !== '' || matches.length < SECTION_THRESHOLD) {
      return { ...empty, results: [...matches] }
    }
    const recentIds = new Set(
      LAB_RECENT_PROJECT_IDS.filter((id) => matches.some((m) => m.option.id === id)).slice(
        0,
        RECENT_LIMIT
      )
    )
    return {
      ...empty,
      recent: LAB_RECENT_PROJECT_IDS.flatMap((id) =>
        recentIds.has(id) ? matches.filter((m) => m.option.id === id) : []
      ),
      projects: matches.filter((m) => m.option.kind === 'project' && !recentIds.has(m.option.id)),
      folders: matches.filter((m) => m.option.kind === 'project-group')
    }
  }, [matches, query])
}

export function HitName({
  text,
  hits,
  className
}: {
  text: string
  hits: readonly number[]
  className?: string
}): React.JSX.Element {
  return (
    <span className={className}>
      <Hit text={text} hits={hits} />
    </span>
  )
}

/**
 * A deep path's identity lives in its tail (`…/services/checkout-api`), which a
 * plain `truncate` is exactly what throws away — two sibling paths then render
 * identically. Keep the last two segments pinned and let the head elide, so the
 * distinguishing end always survives. Short details are untouched.
 */
export function ElidedDetail({
  option,
  hits,
  className
}: {
  option: NewWorkspaceProjectOption
  hits?: readonly number[]
  className?: string
}): React.JSX.Element {
  const detail = option.detail
  const segments = detail.split('/')
  const elides = segments.length > 3 && detail.length > 28
  if (!elides) {
    return (
      <span className={cn('truncate', className)} title={detail}>
        {hits ? <Hit text={detail} hits={hits} /> : detail}
      </span>
    )
  }
  const tail = segments.slice(-2).join('/')
  const head = segments.slice(0, -2).join('/')
  return (
    <span className={cn('flex min-w-0 items-center overflow-hidden', className)} title={detail}>
      {/* Head collapses first; the tail only truncates once the head is gone,
          so a single very long final segment clips instead of overlapping. */}
      <span className="min-w-0 shrink-[999] truncate">{head}</span>
      <span className="min-w-0 shrink truncate">/{tail}</span>
    </span>
  )
}
