import React, { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

// Why: the shared Input primitive always ships shadow-xs. Even with a class
// override, that rim elevation still shows here — build the same box without it.
const SEARCH_INPUT_CLASS =
  'h-8 w-full min-w-0 appearance-none rounded-md border border-border bg-background py-1 pl-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 selection:bg-primary selection:text-primary-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive'

type AutomationListSearchFieldProps = {
  query: string
  isTooLarge: boolean
  onQueryChange: (query: string) => void
  onClear: () => void
  className?: string
}

export function AutomationListSearchField({
  query,
  isTooLarge,
  onQueryChange,
  onClear,
  className
}: AutomationListSearchFieldProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasText = query !== ''
  const tooLargeMessage = isTooLarge
    ? translate(
        'auto.components.automations.AutomationListSearchField.tooLong',
        'Search text is too long — list is unfiltered'
      )
    : null

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={query}
        aria-label={translate(
          'auto.components.automations.AutomationListSearchField.label',
          'Search automations'
        )}
        placeholder={translate(
          'auto.components.automations.AutomationListSearchField.placeholder',
          'Search...'
        )}
        aria-invalid={isTooLarge || undefined}
        aria-describedby={isTooLarge ? 'automations-list-search-too-large' : undefined}
        // Why: the page-level capture Escape handler blurs inputs; this opts out
        // so the first Escape clears the query without also losing focus.
        data-escape-clears-value={hasText ? 'true' : undefined}
        // Why: pin no elevation — class-only shadow-none has been unreliable on this field.
        style={{ boxShadow: 'none' }}
        className={cn(SEARCH_INPUT_CLASS, hasText && (isTooLarge ? 'pr-20' : 'pr-7'))}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
            return
          }
          if (!hasText) {
            return
          }
          event.preventDefault()
          onClear()
        }}
      />
      {hasText ? (
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {isTooLarge ? (
            <span
              id="automations-list-search-too-large"
              title={tooLargeMessage ?? undefined}
              className="text-[10px] text-destructive"
            >
              {translate(
                'auto.components.automations.AutomationListSearchField.tooLongShort',
                'Too long'
              )}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate(
              'auto.components.automations.AutomationListSearchField.clear',
              'Clear search'
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onClear()
              inputRef.current?.focus()
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}
      {isTooLarge ? (
        <div role="status" aria-live="polite" className="sr-only">
          {tooLargeMessage}
        </div>
      ) : null}
    </div>
  )
}
