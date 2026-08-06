import React from 'react'
import { FilePlus, FileText, Globe, Loader2, Smartphone, TerminalSquare } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { ActiveOption } from './tab-create-entry-active-option'

export const RESULT_LISTBOX_ID = 'tab-create-entry-results'

// Index-based (not the option id, which may contain spaces/slashes from file
// paths) so it is always a valid aria-activedescendant IDREF.
export function resultOptionDomId(index: number): string {
  return `tab-create-entry-result-${index}`
}

export function EntryStatusRow({
  loading = false,
  message
}: {
  loading?: boolean
  message: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-6 items-center gap-1.5 rounded-[7px] px-1 text-[11px] leading-5 text-muted-foreground">
      {loading ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
      <span className="truncate">{message}</span>
    </div>
  )
}

export function EntryActionRow({
  id,
  onClick,
  option,
  selected
}: {
  id: string
  onClick: () => void
  option: ActiveOption
  selected: boolean
}): React.JSX.Element {
  const presentation = getActionPresentation(option)

  const row = (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      className={cn(
        'flex h-6 w-full items-center gap-1.5 rounded-[7px] px-1 text-left text-[11px] leading-5 outline-none',
        selected
          ? 'bg-black/8 text-accent-foreground dark:bg-white/14'
          : 'text-muted-foreground hover:bg-black/8 hover:text-accent-foreground dark:hover:bg-white/14'
      )}
      onClick={onClick}
    >
      {presentation.icon}
      <span className={cn('min-w-0 truncate font-medium', presentation.showDetail && 'shrink-0')}>
        {presentation.label}
      </span>
      {presentation.showDetail ? (
        <>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
            ·
          </span>
          {presentation.prioritizeFilename ? (
            <FilenameFirstPath path={presentation.detail} />
          ) : (
            <span className="min-w-0 flex-1 truncate">{presentation.detail}</span>
          )}
        </>
      ) : null}
    </button>
  )

  if (!presentation.showDetail) {
    return row
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      {/* Why: side="right" clears the result list. Above/below would cover the
          sibling rows the user is scanning, and Orca has no native tooltip to
          fall back on — `title` renders nothing in this window. */}
      <TooltipContent
        side="right"
        sideOffset={8}
        showArrow={false}
        className="max-w-[420px] rounded-[5px] border border-border/80 bg-popover px-2 py-1 text-[11px] leading-[15px] break-all text-popover-foreground shadow-[0_2px_8px_rgba(0,0,0,0.28)]"
      >
        {presentation.detail}
      </TooltipContent>
    </Tooltip>
  )
}

// Why: keeps the separator attached to the directory, so `/foo` renders as
// `foo` + `/` rather than re-deriving a separator that may not match the path.
function splitTrailingSegment(path: string): { directory: string; filename: string } {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

  return separatorIndex === -1
    ? { directory: '', filename: path }
    : { directory: path.slice(0, separatorIndex + 1), filename: path.slice(separatorIndex + 1) }
}

function FilenameFirstPath({ path }: { path: string }): React.JSX.Element {
  const { directory, filename } = splitTrailingSegment(path)

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      {/* shrink-0 + max-w-full: the directory gives up all of its width before
          the filename loses a character. */}
      <span className="min-w-0 max-w-full shrink-0 truncate">{filename}</span>
      {directory ? (
        <span className="min-w-0 truncate text-muted-foreground/70">{directory}</span>
      ) : null}
    </span>
  )
}

function getActionPresentation(option: ActiveOption): {
  detail: string
  icon: React.ReactNode
  label: string
  prioritizeFilename?: boolean
  showDetail: boolean
} {
  if (option.kind === 'menu') {
    const icon =
      option.option.kind === 'new-browser' ? (
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
      ) : option.option.kind === 'new-markdown' ? (
        <FilePlus className="size-3.5 shrink-0" aria-hidden="true" />
      ) : option.option.kind === 'open-markdown' ? (
        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
      ) : option.option.kind === 'new-simulator' || option.option.kind === 'go-to-simulator' ? (
        <Smartphone className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <TerminalSquare className="size-3.5 shrink-0" aria-hidden="true" />
      )
    return {
      detail: '',
      icon,
      label: option.option.label,
      showDetail: false
    }
  }
  if (option.kind === 'agent') {
    return {
      detail: option.option.label,
      icon: <AgentIcon agent={option.option.agent} size={14} />,
      label: translate('auto.components.tab.bar.TabBarCreateEntry.b27864279e', 'Launch agent'),
      showDetail: true
    }
  }
  const { classification } = option.option
  if (classification.kind === 'explicit-url' || classification.kind === 'host-url') {
    return {
      detail: classification.url,
      icon: <Globe className="size-3.5 shrink-0" aria-hidden="true" />,
      label: translate('auto.components.tab.bar.TabBarCreateEntry.7cdf8ee0c8', 'Open URL'),
      showDetail: true
    }
  }
  if (classification.kind === 'existing-file' || classification.kind === 'absolute-file') {
    return {
      detail:
        classification.kind === 'absolute-file'
          ? classification.filePath
          : classification.relativePath,
      icon: <FileText className="size-3.5 shrink-0" aria-hidden="true" />,
      label: translate('auto.components.tab.bar.TabBarCreateEntry.25dc1cd653', 'Open file'),
      prioritizeFilename: true,
      showDetail: true
    }
  }
  return {
    detail: classification.relativePath,
    icon: <FilePlus className="size-3.5 shrink-0" aria-hidden="true" />,
    label: translate('auto.components.tab.bar.TabBarCreateEntry.d62d63b807', 'Create file'),
    showDetail: true
  }
}
