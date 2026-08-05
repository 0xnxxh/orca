import type { GlobalSettings, SourceControlGroupOrder } from '../../../../shared/types'
import { DEFAULT_SOURCE_CONTROL_GROUP_ORDER } from '../../../../shared/source-control-group-order'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { matchesSettingsSearch } from './settings-search'

const KEYWORDS = ['group order', 'changes first', 'staged first', 'source control', 'git changes']

function title(): string {
  return translate(
    'auto.components.settings.GitPane.sourceControlGroupOrderTitle',
    'Source Control Group Order'
  )
}

function description(): string {
  return translate(
    'auto.components.settings.GitPane.sourceControlGroupOrderDescription',
    'Choose whether Staged Changes or Changes appear first in Source Control.'
  )
}

export function sourceControlGroupOrderMatchesSearch(searchQuery: string): boolean {
  return matchesSettingsSearch(searchQuery, {
    title: title(),
    description: description(),
    keywords: KEYWORDS
  })
}

export function SourceControlGroupOrderSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const value = settings.sourceControlGroupOrder ?? DEFAULT_SOURCE_CONTROL_GROUP_ORDER
  const settingTitle = title()

  return (
    <SearchableSetting
      title={settingTitle}
      description={description()}
      keywords={KEYWORDS}
      className="max-w-none"
    >
      <SettingsRow
        label={settingTitle}
        description={description()}
        alignTop
        control={
          <SettingsSegmentedControl<SourceControlGroupOrder>
            value={value}
            onChange={(nextValue) => {
              if (nextValue !== value) {
                void updateSettings({ sourceControlGroupOrder: nextValue })
              }
            }}
            ariaLabel={settingTitle}
            size="sm"
            options={[
              {
                value: 'staged-first',
                label: translate('auto.components.settings.GitPane.stagedFirst', 'Staged first')
              },
              {
                value: 'changes-first',
                label: translate('auto.components.settings.GitPane.changesFirst', 'Changes first')
              }
            ]}
          />
        }
      />
    </SearchableSetting>
  )
}
