import { formatAgentTypeLabel } from '@/lib/agent-status'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

export const DASHBOARD_ORCHESTRATOR_CONTEXT_MIME =
  'application/x-orca-dashboard-orchestrator-context'

export type DashboardOrchestratorContext = {
  id: string
  kind: 'project' | 'workspace' | 'agent'
  label: string
  projectName: string
  workspaceName?: string
  agentName?: string
}

export type DashboardOrchestratorWorkspace = {
  id: string
  name: string
  context: DashboardOrchestratorContext
  cards: DashboardCard[]
}

export type DashboardOrchestratorProject = {
  id: string
  name: string
  context: DashboardOrchestratorContext
  workspaces: DashboardOrchestratorWorkspace[]
  agentCount: number
}

function cardAgentName(card: DashboardCard): string {
  return card.conversationName ?? formatAgentTypeLabel(card.agentType)
}

function cleanContextLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function buildDashboardOrchestratorProjects(
  cards: DashboardCard[]
): DashboardOrchestratorProject[] {
  const projects = new Map<
    string,
    {
      name: string
      workspaces: Map<string, { name: string; cards: DashboardCard[] }>
    }
  >()

  for (const card of cards) {
    const project = projects.get(card.repoId) ?? {
      name: card.repoName,
      workspaces: new Map<string, { name: string; cards: DashboardCard[] }>()
    }
    const workspace = project.workspaces.get(card.worktreeId) ?? {
      name: card.worktreeName,
      cards: []
    }
    workspace.cards.push(card)
    project.workspaces.set(card.worktreeId, workspace)
    projects.set(card.repoId, project)
  }

  return [...projects.entries()]
    .map(([projectId, project]): DashboardOrchestratorProject => {
      const projectName = cleanContextLabel(project.name)
      const workspaces = [...project.workspaces.entries()]
        .map(([workspaceId, workspace]): DashboardOrchestratorWorkspace => {
          const workspaceName = cleanContextLabel(workspace.name)
          return {
            id: workspaceId,
            name: workspaceName,
            context: {
              id: `workspace:${workspaceId}`,
              kind: 'workspace',
              label: workspaceName,
              projectName,
              workspaceName
            },
            cards: [...workspace.cards].sort(
              (left, right) => right.stateChangedAt - left.stateChangedAt
            )
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name))
      return {
        id: projectId,
        name: projectName,
        context: {
          id: `project:${projectId}`,
          kind: 'project',
          label: projectName,
          projectName
        },
        workspaces,
        agentCount: workspaces.reduce((count, workspace) => count + workspace.cards.length, 0)
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function dashboardAgentContext(
  card: DashboardCard,
  projectName: string,
  workspaceName: string
): DashboardOrchestratorContext {
  const agentName = cleanContextLabel(cardAgentName(card))
  return {
    id: `agent:${card.paneKey}`,
    kind: 'agent',
    label: agentName,
    projectName,
    workspaceName,
    agentName
  }
}

export function listDashboardOrchestratorContexts(
  projects: DashboardOrchestratorProject[]
): DashboardOrchestratorContext[] {
  return projects.flatMap((project) => [
    project.context,
    ...project.workspaces.flatMap((workspace) => [
      workspace.context,
      ...workspace.cards.map((card) => dashboardAgentContext(card, project.name, workspace.name))
    ])
  ])
}

function describeContext(context: DashboardOrchestratorContext): string {
  if (context.kind === 'project') {
    return `project "${context.projectName}"`
  }
  if (context.kind === 'workspace') {
    return `workspace "${context.workspaceName}" in project "${context.projectName}"`
  }
  return `agent "${context.agentName}" in workspace "${context.workspaceName}"`
}

export function buildDashboardOrchestrationPrompt(
  message: string,
  contexts: DashboardOrchestratorContext[]
): string {
  const scope =
    contexts.length === 0
      ? 'Coordinate this request across the entire Orca fleet.'
      : `Coordinate this request with these selected fleet participants: ${contexts.map(describeContext).join('; ')}.`
  return `$orchestration ${scope}\n\n${message}`
}
