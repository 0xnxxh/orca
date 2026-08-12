import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import type { SkillCloudVersion } from '../../../../shared/skill-cloud-contract'
import type { SkillBundleInstallPreview } from '../../../../shared/skill-bundle-install-contract'
import { translate } from '@/i18n/i18n'

type BundleVersion = SkillCloudVersion & {
  manifest: Extract<SkillCloudVersion['manifest'], { skills: unknown }>
}

const CONFLICT_STATES = new Set(['modified', 'unowned', 'external-link', 'name-collision'])

function skillCounts(skill: BundleVersion['manifest']['skills'][number]): {
  scripts: number
  executables: number
} {
  return {
    scripts: skill.files.filter((file) => file.path.startsWith('scripts/')).length,
    executables: skill.files.filter((file) => file.executable).length
  }
}

export function SkillBundleInstallReview(props: {
  version: BundleVersion
  selectedSkillIds: ReadonlySet<string>
  destinationPreview: SkillBundleInstallPreview | null
  replaceSkillIds: ReadonlySet<string>
  busy: boolean
  onToggleSkill(skillId: string, selected: boolean): void
  onToggleAll(selected: boolean): void
  onToggleReplace(skillId: string, replace: boolean): void
  children: ReactNode
}): React.JSX.Element {
  const { manifest } = props.version
  const selectedSkills = manifest.skills.filter((skill) => props.selectedSkillIds.has(skill.id))
  const selectedFiles = selectedSkills.flatMap((skill) => skill.files)
  const conflicts =
    props.destinationPreview?.skills.filter((skill) => CONFLICT_STATES.has(skill.currentState)) ??
    []
  const previewSkills = props.destinationPreview?.skills ?? []
  const allSelected = props.selectedSkillIds.size === manifest.skills.length

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold">{manifest.bundleName}</h3>
            <p className="break-words text-xs leading-5 text-muted-foreground">
              {manifest.description}
            </p>
          </div>
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e01',
              'Immutable version'
            )}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e02',
              '{{value0}} skills',
              { value0: selectedSkills.length }
            )}
          </Badge>
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e03',
              '{{value0}} files',
              { value0: selectedFiles.length }
            )}
          </Badge>
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e04',
              '{{value0}} scripts',
              {
                value0: selectedFiles.filter((file) => file.path.startsWith('scripts/')).length
              }
            )}
          </Badge>
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e05',
              '{{value0}} executable',
              { value0: selectedFiles.filter((file) => file.executable).length }
            )}
          </Badge>
        </div>
        {props.destinationPreview ? (
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground" role="status">
            <Badge variant="outline">
              {translate(
                'auto.components.skills.SkillBundleInstallReview.01c5a11e14',
                '{{value0}} new',
                { value0: previewSkills.filter((skill) => skill.currentState === 'missing').length }
              )}
            </Badge>
            <Badge variant="outline">
              {translate(
                'auto.components.skills.SkillBundleInstallReview.01c5a11e15',
                '{{value0}} unchanged',
                {
                  value0: previewSkills.filter((skill) => skill.currentState === 'unchanged').length
                }
              )}
            </Badge>
            <Badge variant="outline">
              {translate(
                'auto.components.skills.SkillBundleInstallReview.01c5a11e16',
                '{{value0}} updates',
                {
                  value0: previewSkills.filter((skill) => skill.currentState === 'clean-update')
                    .length
                }
              )}
            </Badge>
            <Badge variant="outline">
              {translate(
                'auto.components.skills.SkillBundleInstallReview.01c5a11e17',
                '{{value0}} conflicts',
                { value0: conflicts.length }
              )}
            </Badge>
          </div>
        ) : null}
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {translate('auto.components.skills.SkillBundleInstallReview.01c5a11e06', 'SHA-256')}{' '}
          {manifest.bundleDigest}
        </p>
        {props.version.publisher ? (
          <p className="break-words text-xs text-muted-foreground">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e07',
              'Published by Orca user'
            )}{' '}
            {props.version.publisher.userId}
            {props.version.publisher.organizationId
              ? translate(
                  'auto.components.skills.SkillBundleInstallReview.01c5a11e08',
                  ' in organization {{value0}}',
                  { value0: props.version.publisher.organizationId }
                )
              : ''}
            .
          </p>
        ) : null}
        {props.version.releaseNotes.trim() ? (
          <p className="break-words whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e09',
              'Release notes:'
            )}{' '}
            {props.version.releaseNotes}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.skills.SkillBundleInstallReview.01c5a11e0a',
            'Skills contain instructions and may include scripts. Treat them as code from their author.'
          )}
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {translate(
                'auto.components.skills.SkillBundleInstallReview.01c5a11e0b',
                'Skills to install'
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.skills.SkillBundleInstallReview.01c5a11e0c',
                'Choose any subset from this bundle.'
              )}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={allSelected ? true : props.selectedSkillIds.size ? 'indeterminate' : false}
              disabled={props.busy}
              onCheckedChange={(checked) => props.onToggleAll(checked === true)}
            />
            {translate('auto.components.skills.SkillBundleInstallReview.01c5a11e0d', 'Select all')}
          </label>
        </div>
        <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-1 scrollbar-sleek">
          {manifest.skills.map((skill) => {
            const counts = skillCounts(skill)
            const state = props.destinationPreview?.skills.find((item) => item.id === skill.id)
            return (
              <label
                key={skill.id}
                className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent"
              >
                <Checkbox
                  checked={props.selectedSkillIds.has(skill.id)}
                  disabled={props.busy}
                  onCheckedChange={(checked) => props.onToggleSkill(skill.id, checked === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{skill.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.description ||
                      translate(
                        'auto.components.skills.SkillBundleInstallReview.01c5a11e0e',
                        'No description'
                      )}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <span className="block">
                    {translate(
                      'auto.components.skills.SkillBundleInstallReview.01c5a11e0f',
                      '{{value0}} files · {{value1}} scripts',
                      { value0: skill.files.length, value1: counts.scripts }
                    )}
                  </span>
                  <span className="block">
                    {translate(
                      'auto.components.skills.SkillBundleInstallReview.01c5a11e10',
                      '{{value0}} executable',
                      { value0: counts.executables }
                    )}
                    {state ? ` · ${state.currentState}` : ''}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </section>

      {props.children}

      {conflicts.length ? (
        <section className="space-y-3 rounded-md border border-border p-3" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" />{' '}
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e11',
              'Local copies need a decision'
            )}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.skills.SkillBundleInstallReview.01c5a11e12',
              'Orca will keep these local copies by default. Select only the copies you want to discard and replace.'
            )}
          </p>
          <div className="space-y-2">
            {conflicts.map((conflict) => (
              <label key={conflict.id} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={props.replaceSkillIds.has(conflict.id)}
                  disabled={props.busy}
                  onCheckedChange={(checked) =>
                    props.onToggleReplace(conflict.id, checked === true)
                  }
                />
                {translate(
                  'auto.components.skills.SkillBundleInstallReview.01c5a11e13',
                  'Replace {{value0}} ({{value1}})',
                  { value0: conflict.name, value1: conflict.currentState }
                )}
              </label>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
