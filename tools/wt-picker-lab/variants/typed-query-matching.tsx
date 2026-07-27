import React from 'react'
import { FolderOpen } from 'lucide-react'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import type { NewWorkspaceProjectOption } from '../design-contract'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'

/**
 * Turns a typed query into ranked, highlighted, armed rows — the shared engine
 * behind both typed-first designs in `design-typed.tsx`.
 */

export type Scored = {
  option: NewWorkspaceProjectOption
  score: number
  nameHits: readonly number[]
  detailHits: readonly number[]
}

export type Row = { key: string; scored: Scored | null }

function substringHits(text: string, query: string): number[] | null {
  const at = text.toLowerCase().indexOf(query)
  return at < 0 ? null : Array.from({ length: query.length }, (_, offset) => at + offset)
}

/**
 * Verbatim run, else scattered subsequence. Only names get the loose pass —
 * subsequence over a detail line matches "scr" against "3 hosts configured".
 */
function nameHitsFor(name: string, query: string): number[] | null {
  const verbatim = substringHits(name, query)
  if (verbatim) {
    return verbatim
  }
  const haystack = name.toLowerCase()
  const hits: number[] = []
  let cursor = 0
  for (const char of query) {
    const found = haystack.indexOf(char, cursor)
    if (found < 0) {
      return null
    }
    hits.push(found)
    cursor = found + 1
  }
  return hits
}

function nameScore(name: string, hits: readonly number[]): number {
  const first = hits[0]
  const contiguous = (hits.at(-1) ?? first) - first === hits.length - 1
  const boundary = first === 0 || /[^a-z0-9]/i.test(name[first - 1] ?? '')
  const base = contiguous ? (first === 0 ? 900 : boundary ? 780 : 700) : 420
  return base - name.length * 0.4
}

export function rankOptions(
  options: readonly NewWorkspaceProjectOption[],
  rawQuery: string
): Scored[] {
  const query = rawQuery.trim().toLowerCase()
  const scored: Scored[] = []
  for (const option of options) {
    const recentAt = LAB_RECENT_PROJECT_IDS.indexOf(option.id)
    const recency = recentAt < 0 ? 0 : 32 - recentAt * 4
    if (query.length === 0) {
      scored.push({ option, score: recency, nameHits: [], detailHits: [] })
      continue
    }
    const nameHits = nameHitsFor(option.displayName, query)
    const detailHits = substringHits(option.detail, query)
    if (!nameHits && !detailHits) {
      continue
    }
    scored.push({
      option,
      score: (nameHits ? nameScore(option.displayName, nameHits) : 260) + recency,
      nameHits: nameHits ?? [],
      detailHits: detailHits ?? []
    })
  }
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.option.displayName.localeCompare(b.option.displayName) ||
      a.option.detail.localeCompare(b.option.detail)
  )
}

/** Ids whose displayName repeats — those rows can't be read by name alone. */
export function useAmbiguousIds(options: readonly NewWorkspaceProjectOption[]): Set<string> {
  return React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const option of options) {
      counts.set(option.displayName, (counts.get(option.displayName) ?? 0) + 1)
    }
    return new Set(
      options.filter((o) => (counts.get(o.displayName) ?? 0) > 1).map((option) => option.id)
    )
  }, [options])
}

/** `~/src/scratch · devbox` → `~/src · devbox`: the part the name doesn't carry. */
export function discriminator(option: NewWorkspaceProjectOption): string {
  const at = option.detail.indexOf(`/${option.displayName}`)
  if (at < 0) {
    return option.detail
  }
  const trimmed = (
    option.detail.slice(0, at) + option.detail.slice(at + option.displayName.length + 1)
  ).trim()
  return trimmed || option.detail
}

export function useRows(
  options: readonly NewWorkspaceProjectOption[],
  query: string,
  onAddProject?: () => void
): { matches: Scored[]; rows: Row[] } {
  return React.useMemo(() => {
    const matches = rankOptions(options, query)
    const rows: Row[] = matches.map((scored) => ({ key: scored.option.id, scored }))
    if (onAddProject) {
      rows.push({ key: 'add-project', scored: null })
    }
    return { matches, rows }
  }, [options, query, onAddProject])
}

export type ArmedRow = {
  index: number
  armed: Row | null
  /** Identity check, so a design can slice its visible rows without losing armed. */
  isArmed: (row: Row) => boolean
  arm: (key: string) => void
  move: (delta: number) => void
}

/**
 * Enter fires the armed row and there is always exactly one. Armed is tracked
 * by key, not index, so a list arriving late over SSH can't slide a different
 * project under a keypress the user already aimed.
 */
export function useArmedRow(rows: readonly Row[], resetToken: string): ArmedRow {
  const [armedKey, setArmedKey] = React.useState<string | null>(null)
  React.useEffect(() => {
    setArmedKey(null)
  }, [resetToken])
  const found = armedKey === null ? -1 : rows.findIndex((row) => row.key === armedKey)
  const index = Math.max(found, 0)
  return {
    index,
    armed: rows[index] ?? null,
    isArmed: (row) => row.key === rows[index]?.key,
    arm: setArmedKey,
    move: (delta) => {
      const next = Math.min(Math.max(index + delta, 0), rows.length - 1)
      setArmedKey(rows[next]?.key ?? null)
    }
  }
}

export function scrollArmedIntoView(container: HTMLElement | null): void {
  container?.querySelector('[data-armed="true"]')?.scrollIntoView({ block: 'nearest' })
}

export function Hit({ text, hits }: { text: string; hits: readonly number[] }): React.JSX.Element {
  const marks = new Set(hits)
  if (marks.size === 0) {
    return <span className="min-w-0 truncate">{text}</span>
  }
  return (
    <span className="min-w-0 truncate">
      {[...text].map((char, index) =>
        marks.has(index) ? (
          <mark
            key={`${index}-${char}`}
            className="bg-transparent p-0 font-semibold text-foreground underline decoration-ring underline-offset-2"
          >
            {char}
          </mark>
        ) : (
          char
        )
      )}
    </span>
  )
}

export function Glyph({ option }: { option: NewWorkspaceProjectOption }): React.JSX.Element {
  return option.kind === 'project-group' ? (
    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <RepoBadgeMark color={option.badgeColor} className="rounded-full" />
  )
}

/** Both designs are Input-shaped without being an `<Input>`, so share the recipe. */
export const FIELD_SHELL =
  'w-full min-w-0 rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30'
export const INVALID_SHELL = 'border-destructive ring-destructive/20 dark:ring-destructive/40'
export const RAW_INPUT =
  'w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70'
export const COUNT = 'shrink-0 text-[11px] tabular-nums text-muted-foreground'

export const keepFocus = (event: React.MouseEvent | Event): void => event.preventDefault()
