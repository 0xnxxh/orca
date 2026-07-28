import React from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import ProjectCombobox from '@/components/new-workspace/ProjectCombobox'
import RunTargetCombobox from '@/components/new-workspace/RunTargetCombobox'
import type { ProjectHostSetupOption } from '@/lib/project-host-setup-options'
import { LAB_PROJECT_OPTIONS } from './fixtures'

const HOSTS: ProjectHostSetupOption[] = [
  {
    kind: 'ready',
    id: 'setup-local',
    projectId: 'p',
    hostId: 'local' as never,
    repoId: 'r',
    label: 'Local Mac',
    detail: 'ready',
    path: '~/Developer/orca'
  },
  {
    kind: 'needs-setup',
    id: 'setup-devbox',
    projectId: 'p',
    hostId: 'ssh:devbox' as never,
    label: 'Devbox',
    detail: 'Connect this host to set up projects',
    isAvailable: true,
    attention: false,
    connectAction: { kind: 'ssh', targetId: 'devbox' }
  }
]

/** Project + Run on together — the spacing between them is the thing under review. */
export default function ComposerPairFrame({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [projectId, setProjectId] = React.useState<string | null>('p-orca')
  const [hostId, setHostId] = React.useState<string | null>('setup-local')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogTitle className="text-base font-semibold">Create worktree</DialogTitle>
        <div className="min-w-0 space-y-4 pt-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Project</label>
            <ProjectCombobox
              options={LAB_PROJECT_OPTIONS}
              value={projectId}
              onValueChange={setProjectId}
              onAddProject={() => {}}
              placeholder="Choose project"
            />
            <div className="space-y-1 pt-3" data-lab-run-on-block="true">
              <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
                Run on
              </label>
              <RunTargetCombobox
                hostOptions={HOSTS}
                hostValue={hostId}
                onHostChange={setHostId}
                recipes={[] as never}
                recipeValue={null}
                onRecipeChange={() => {}}
                onAddSshHost={() => {}}
                onAddRemoteServer={() => {}}
                onConnectHost={async () => {}}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              placeholder="Search issues, PRs, or branches"
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
