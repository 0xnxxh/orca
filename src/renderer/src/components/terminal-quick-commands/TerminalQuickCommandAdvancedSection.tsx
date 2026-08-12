import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { TerminalQuickCommandAppendEnterSwitch } from './TerminalQuickCommandAppendEnterSwitch'
import { TerminalQuickCommandCollapsibleRow } from './TerminalQuickCommandCollapsibleRow'

type TerminalQuickCommandAdvancedSectionProps = {
  appendEnter: boolean
  advancedOpen: boolean
  setAdvancedOpen: Dispatch<SetStateAction<boolean>>
  toggleAppendEnter: () => void
}

/** Why a disclosure for one switch: Append Enter defaults on and is rarely
 *  changed, so it stays out of the common path. Scope is not here — it has no
 *  ambient default when the dialog is opened from Settings. */
export function TerminalQuickCommandAdvancedSection({
  appendEnter,
  advancedOpen,
  setAdvancedOpen,
  toggleAppendEnter
}: TerminalQuickCommandAdvancedSectionProps): React.JSX.Element {
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAdvancedOpen((current) => !current)}
        className="-ml-2 text-xs"
      >
        {translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandDialog.925b8e0f6e',
          'Advanced'
        )}
        <ChevronDown className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')} />
      </Button>

      <TerminalQuickCommandCollapsibleRow open={advancedOpen} className="px-1 pt-2 pb-1">
        <TerminalQuickCommandAppendEnterSwitch
          appendEnter={appendEnter}
          disabled={!advancedOpen}
          onToggle={toggleAppendEnter}
        />
      </TerminalQuickCommandCollapsibleRow>
    </div>
  )
}
