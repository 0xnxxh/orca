import React from 'react'
import { FolderOpen, Search } from 'lucide-react'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { cn } from '@/lib/utils'
import {
  searchNewWorkspaceProjectOptions,
  type NewWorkspaceProjectOption
} from '@/lib/new-workspace-project-options'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'

export const IS_MAC = navigator.userAgent.includes('Mac')
export const HINT = 'shrink-0 text-[11px] text-muted-foreground'
export const DETAIL = 'shrink-0 truncate text-[11px] text-muted-foreground'
export const LINE_INPUT =
  'h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'

/** `null` renders the search glyph, so the unchosen line uses the same slot. */
export function OptionMark({
  option,
  className
}: {
  option: NewWorkspaceProjectOption | null
  className?: string
}): React.JSX.Element {
  if (option === null) {
    return <Search className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />
  }
  return option.kind === 'project-group' ? (
    <FolderOpen className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />
  ) : (
    <RepoBadgeMark color={option.badgeColor} className={className} />
  )
}

/**
 * Reads the picked project from the local echo until `value` catches up, so an
 * SSH round-trip can't blink the line back to the placeholder mid-pick.
 */
export function useOptimisticSelection(
  options: readonly NewWorkspaceProjectOption[],
  value: string | null
): [NewWorkspaceProjectOption | null, (projectId: string) => void] {
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  React.useEffect(() => {
    setPendingId(null)
  }, [value])
  const id = value ?? pendingId
  return [options.find((option) => option.id === id) ?? null, setPendingId]
}

function recencyRank(option: NewWorkspaceProjectOption): number {
  const index = LAB_RECENT_PROJECT_IDS.indexOf(option.id)
  return index === -1 ? LAB_RECENT_PROJECT_IDS.length : index
}

/** Recents lead; a query re-sorts name-prefix hits above substring hits. */
function rank(
  options: readonly NewWorkspaceProjectOption[],
  query: string
): { items: NewWorkspaceProjectOption[]; headings: Map<number, string> } {
  const matches = searchNewWorkspaceProjectOptions(options, query)
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length > 0) {
    const hit = (o: NewWorkspaceProjectOption): number =>
      o.displayName.toLowerCase().startsWith(trimmed) ? 0 : 1
    return {
      items: [...matches].sort((a, b) => hit(a) - hit(b) || recencyRank(a) - recencyRank(b)),
      headings: new Map()
    }
  }
  const items = [...matches].sort((a, b) => recencyRank(a) - recencyRank(b))
  const recent = items.filter((o) => recencyRank(o) < LAB_RECENT_PROJECT_IDS.length).length
  return {
    items,
    headings:
      recent > 0 && items.length > 6
        ? new Map([
            [0, 'Recent'],
            [recent, 'All projects']
          ])
        : new Map<number, string>()
  }
}

type PickerNav = {
  items: NewWorkspaceProjectOption[]
  headings: Map<number, string>
  active: number
  addIndex: number
  setActive: (index: number) => void
  /** Consumes arrow keys and reports whether it handled the event. */
  navigate: (event: React.KeyboardEvent, horizontal?: boolean) => boolean
  /** Pointer + a11y wiring so a mouse user can reach every keyboard target. */
  rowProps: (index: number, commit: () => void) => React.ComponentProps<'div'>
}

export function usePickerNav(
  options: readonly NewWorkspaceProjectOption[],
  query: string,
  hasAdd: boolean,
  selectedId: string | null
): PickerNav {
  const [activeIndex, setActive] = React.useState(0)
  const { items, headings } = React.useMemo(() => rank(options, query), [options, query])
  const rowCount = items.length + (hasAdd ? 1 : 0)
  const active = rowCount === 0 ? 0 : Math.min(activeIndex, rowCount - 1)

  const navigate = React.useCallback(
    (event: React.KeyboardEvent, horizontal = false): boolean => {
      const forward = event.key === 'ArrowDown' || (horizontal && event.key === 'ArrowRight')
      const back = event.key === 'ArrowUp' || (horizontal && event.key === 'ArrowLeft')
      if (!forward && !back) {
        return false
      }
      event.preventDefault()
      if (rowCount > 0) {
        setActive((i) => (Math.min(i, rowCount - 1) + (forward ? 1 : -1) + rowCount) % rowCount)
      }
      return true
    },
    [rowCount]
  )

  // `data-active` isn't in ComponentProps<'div'>, so widen with the data attr.
  const rowProps = (
    index: number,
    commit: () => void
  ): React.ComponentProps<'div'> & { 'data-active'?: true } => ({
    role: 'option',
    'aria-selected': items[index]?.id === selectedId,
    'data-active': index === active || undefined,
    onPointerMove: () => setActive(index),
    onMouseDown: (event) => event.preventDefault(),
    onClick: commit
  })

  return {
    items,
    headings,
    active,
    addIndex: hasAdd ? items.length : -1,
    setActive,
    navigate,
    rowProps
  }
}
