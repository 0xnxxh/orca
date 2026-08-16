import { useState } from 'react'
import { Download, FolderOpen } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { RemoteFileBrowser } from '@/components/sidebar/RemoteFileBrowser'
import type { NeedsSetupProjectHostOption } from '@/lib/project-host-setup-options'
import type { RepoKind } from '../../../../shared/repo-types'
import {
  getProjectLocationBrowseTarget,
  pickLocalProjectLocationFolder,
  type ProjectLocationBrowseTarget
} from './set-project-location-browse'
import { CloneForm, ExistingFolderForm, LocationActionButton } from './SetProjectLocationForms'

type DialogView = 'choose' | 'existing' | 'clone' | 'browse'
type BrowseField = 'existing' | 'clone'

type SetProjectLocationDialogProps = {
  option: NeedsSetupProjectHostOption | null
  projectName: string
  projectKind: RepoKind
  defaultCloneUrl: string
  onOpenChange: (open: boolean) => void
  onReady: (setupId: string) => void
}

export function SetProjectLocationDialog({
  option,
  projectName,
  projectKind,
  defaultCloneUrl,
  onOpenChange,
  onReady
}: SetProjectLocationDialogProps): React.JSX.Element {
  const open = option !== null
  const [renderOption, setRenderOption] = useState(option)
  if (option !== null && option !== renderOption) {
    setRenderOption(option)
  }
  const activeOption = option ?? renderOption

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent
        data-testid="set-project-location-dialog"
        className="sm:max-w-lg"
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onPointerDownOutside={(event) => event.stopPropagation()}
        onInteractOutside={(event) => event.stopPropagation()}
      >
        {activeOption ? (
          <SetProjectLocationDialogBody
            key={activeOption.id}
            option={activeOption}
            projectName={projectName}
            projectKind={projectKind}
            defaultCloneUrl={defaultCloneUrl}
            onReady={onReady}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SetProjectLocationDialogBody({
  option,
  projectName,
  projectKind,
  defaultCloneUrl,
  onReady
}: {
  option: NeedsSetupProjectHostOption
  projectName: string
  projectKind: RepoKind
  defaultCloneUrl: string
  onReady: (setupId: string) => void
}): React.JSX.Element {
  const setupProjectExistingFolder = useAppStore((state) => state.setupProjectExistingFolder)
  const setupProjectClone = useAppStore((state) => state.setupProjectClone)
  const [view, setView] = useState<DialogView>('choose')
  const [browseField, setBrowseField] = useState<BrowseField>('existing')
  const [setupPath, setSetupPath] = useState('')
  const [setupKind, setSetupKind] = useState<RepoKind>(projectKind)
  const [cloneUrl, setCloneUrl] = useState(defaultCloneUrl)
  const [cloneDestination, setCloneDestination] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const browseTarget = getProjectLocationBrowseTarget(option.hostId)
  const canClone = projectKind === 'git'

  const openHostBrowser = (field: BrowseField): void => {
    if (browseTarget.kind === 'local') {
      void pickLocalProjectLocationFolder(field === 'existing' ? setSetupPath : setCloneDestination)
      return
    }
    setBrowseField(field)
    setView('browse')
  }

  const handleExistingSubmit = async (): Promise<void> => {
    if (!setupPath.trim()) {
      return
    }
    setIsSubmitting(true)
    try {
      const result = await setupProjectExistingFolder({
        projectId: option.projectId,
        hostId: option.hostId,
        path: setupPath.trim(),
        kind: setupKind,
        displayName: projectName
      })
      if (result) {
        onReady(result.setup.id)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCloneSubmit = async (): Promise<void> => {
    if (!cloneUrl.trim() || !cloneDestination.trim()) {
      return
    }
    setIsSubmitting(true)
    try {
      const result = await setupProjectClone({
        projectId: option.projectId,
        hostId: option.hostId,
        url: cloneUrl.trim(),
        destination: cloneDestination.trim(),
        displayName: projectName
      })
      if (result) {
        onReady(result.setup.id)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (view === 'browse' && browseTarget.kind !== 'local') {
    return (
      <HostFilesystemBrowseView
        browseTarget={browseTarget}
        initialPath={browseField === 'existing' ? setupPath : cloneDestination}
        onSelect={(path) => {
          if (browseField === 'existing') {
            setSetupPath(path)
            setView('existing')
            return
          }
          setCloneDestination(path)
          setView('clone')
        }}
        onCancel={() => setView(browseField)}
      />
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {translate(
            'auto.components.new.workspace.SetProjectLocationDialog.title',
            'Set project location'
          )}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.new.workspace.SetProjectLocationDialog.description',
            'Choose where {{project}} lives on {{host}}.',
            { project: projectName, host: option.label }
          )}
        </DialogDescription>
      </DialogHeader>
      {view === 'choose' ? (
        <div className="space-y-2">
          <LocationActionButton
            icon={FolderOpen}
            title={translate(
              'auto.components.new.workspace.SetProjectLocationDialog.browseFolder',
              'Browse folder'
            )}
            description={translate(
              'auto.components.new.workspace.SetProjectLocationDialog.browseFolderHelp',
              'Use an existing checkout or folder on this host.'
            )}
            onClick={() => {
              setView('existing')
              if (browseTarget.kind === 'local' && !setupPath) {
                void pickLocalProjectLocationFolder(setSetupPath)
              }
            }}
          />
          {canClone ? (
            <LocationActionButton
              icon={Download}
              title={translate(
                'auto.components.new.workspace.SetProjectLocationDialog.cloneFromUrl',
                'Clone from URL'
              )}
              description={translate(
                'auto.components.new.workspace.SetProjectLocationDialog.cloneFromUrlHelp',
                'Clone this repository onto {{host}}.',
                { host: option.label }
              )}
              onClick={() => setView('clone')}
            />
          ) : null}
        </div>
      ) : null}
      {view === 'existing' ? (
        <ExistingFolderForm
          setupPath={setupPath}
          setupKind={setupKind}
          isSubmitting={isSubmitting}
          onBack={() => setView('choose')}
          onPathChange={setSetupPath}
          onKindChange={setSetupKind}
          onBrowse={() => openHostBrowser('existing')}
          onSubmit={() => void handleExistingSubmit()}
        />
      ) : null}
      {view === 'clone' ? (
        <CloneForm
          cloneUrl={cloneUrl}
          cloneDestination={cloneDestination}
          isSubmitting={isSubmitting}
          onBack={() => setView('choose')}
          onCloneUrlChange={setCloneUrl}
          onCloneDestinationChange={setCloneDestination}
          onBrowse={() => openHostBrowser('clone')}
          onSubmit={() => void handleCloneSubmit()}
        />
      ) : null}
    </>
  )
}

function HostFilesystemBrowseView({
  browseTarget,
  initialPath,
  onSelect,
  onCancel
}: {
  browseTarget: Exclude<ProjectLocationBrowseTarget, { kind: 'local' }>
  initialPath: string
  onSelect: (path: string) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {translate(
            'auto.components.sidebar.CreateProjectLocationField.f520f83a97',
            'Browse host filesystem'
          )}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.sidebar.CreateProjectLocationField.b589b77997',
            'Navigate to a directory and click Select to choose it.'
          )}
        </DialogDescription>
      </DialogHeader>
      {browseTarget.kind === 'ssh' ? (
        <RemoteFileBrowser
          targetId={browseTarget.targetId}
          initialPath={initialPath || '~'}
          onSelect={onSelect}
          onCancel={onCancel}
        />
      ) : (
        <RemoteFileBrowser
          runtimeEnvironmentId={browseTarget.environmentId}
          initialPath={initialPath || '~'}
          onSelect={onSelect}
          onCancel={onCancel}
        />
      )}
    </>
  )
}
