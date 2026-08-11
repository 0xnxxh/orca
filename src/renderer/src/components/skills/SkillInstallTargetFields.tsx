import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SKILL_INSTALL_CAPABILITY } from '../../../../shared/skill-install-capability'
import type { SkillInstallWorkspaceChoice } from './skill-install-workspace-choices'

export function SkillInstallTargetFields(props: {
  environmentId: string
  onEnvironmentChange(value: string): void
  scope: 'global' | 'workspace'
  onScopeChange(value: 'global' | 'workspace'): void
  workspace: string
  onWorkspaceChange(value: string): void
  executionTarget: { kind: 'wsl'; distro: string } | null
  onExecutionTargetChange(value: { kind: 'wsl'; distro: string } | null): void
  runtimeEnvironments: { id: string; name: string }[]
  runtimeStatus: Map<string, { status: { capabilities?: string[] } | null }>
  sshConnections: { id: string; label: string; connected: boolean }[]
  workspaceChoices: SkillInstallWorkspaceChoice[]
}): React.JSX.Element {
  const [wslDistros, setWslDistros] = useState<string[]>([])

  useEffect(() => {
    let active = true
    if (props.environmentId.startsWith('ssh:')) {
      setWslDistros([])
      return () => {
        active = false
      }
    }
    void window.api.skills
      .listWslDistros(props.environmentId === 'local' ? undefined : props.environmentId)
      .then((distros) => {
        if (active) {
          setWslDistros(distros)
        }
      })
      .catch(() => {
        if (active) {
          setWslDistros([])
        }
      })
    return () => {
      active = false
    }
  }, [props.environmentId])

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Machine</Label>
          <Select
            value={props.environmentId}
            onValueChange={(value) => {
              props.onEnvironmentChange(value)
              props.onWorkspaceChange('')
              props.onExecutionTargetChange(null)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">This computer</SelectItem>
              {props.runtimeEnvironments.map((environment) => {
                const status = props.runtimeStatus.get(environment.id)?.status
                const unsupported =
                  status !== null &&
                  status !== undefined &&
                  status.capabilities?.includes(SKILL_INSTALL_CAPABILITY) !== true
                return (
                  <SelectItem key={environment.id} value={environment.id} disabled={unsupported}>
                    {environment.name}
                    {unsupported ? ' — update required' : ''}
                  </SelectItem>
                )
              })}
              {props.sshConnections.map((connection) => (
                <SelectItem
                  key={`ssh:${connection.id}`}
                  value={`ssh:${connection.id}`}
                  disabled={!connection.connected}
                >
                  {connection.label}
                  {!connection.connected ? ' — disconnected' : ' · SSH'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Destination</Label>
          <Select
            value={props.scope}
            onValueChange={(value) => props.onScopeChange(value as 'global' | 'workspace')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global skills</SelectItem>
              <SelectItem value="workspace">One workspace</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {props.scope === 'global' && wslDistros.length > 0 ? (
        <section className="space-y-2">
          <Label>Execution environment</Label>
          <Select
            value={props.executionTarget?.distro ?? 'host'}
            onValueChange={(value) =>
              props.onExecutionTargetChange(
                value === 'host' ? null : { kind: 'wsl', distro: value }
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">Host operating system</SelectItem>
              {wslDistros.map((distro) => (
                <SelectItem key={distro} value={distro}>
                  WSL · {distro}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
      ) : null}

      {props.scope === 'workspace' ? (
        <section className="space-y-2">
          <Label>Workspace</Label>
          <Select value={props.workspace} onValueChange={props.onWorkspaceChange}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a worktree or folder" />
            </SelectTrigger>
            <SelectContent>
              {props.workspaceChoices.map((choice) => (
                <SelectItem key={`${choice.kind}:${choice.id}`} value={choice.id}>
                  {choice.label} · {choice.kind === 'worktree' ? 'Git worktree' : 'Folder'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.workspaceChoices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No workspaces are known on this machine.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
