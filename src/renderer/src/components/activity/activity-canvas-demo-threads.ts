import type { ActivityCanvasThreadInput } from './activity-canvas-types'

/** Sample graph used when the live agent feed is empty so the canvas is reviewable. */
export function buildDemoCanvasThreads(): ActivityCanvasThreadInput[] {
  const now = Date.now()
  return [
    {
      paneKey: 'demo:orchestrator',
      paneTitle: 'Coordinate agents view prototype',
      workspaceTitle: 'prototype-new-agents-view',
      projectLabel: 'orca',
      agentType: 'claude',
      agentState: 'working',
      agentStateLabel: 'Working',
      responsePreview: 'Dispatching canvas layout + list toggle…',
      latestTimestamp: now - 30_000,
      unread: false,
      parentPaneKey: null,
      monogram: 'OR'
    },
    {
      paneKey: 'demo:a1',
      paneTitle: 'Scaffold list/canvas view toggle',
      workspaceTitle: 'prototype-new-agents-view',
      projectLabel: 'orca',
      agentType: 'claude',
      agentState: 'done',
      agentStateLabel: 'Done',
      responsePreview: 'ToggleGroup wired into the filter bar.',
      latestTimestamp: now - 120_000,
      unread: false,
      parentPaneKey: 'demo:orchestrator'
    },
    {
      paneKey: 'demo:a2',
      paneTitle: 'Build agents canvas layout',
      workspaceTitle: 'prototype-new-agents-view',
      projectLabel: 'orca',
      agentType: 'codex',
      agentState: 'working',
      agentStateLabel: 'Working',
      responsePreview: 'Placing forest + isolated grid…',
      latestTimestamp: now - 20_000,
      unread: true,
      parentPaneKey: 'demo:orchestrator'
    },
    {
      paneKey: 'demo:a3',
      paneTitle: 'Style nodes like orca-viz',
      workspaceTitle: 'prototype-new-agents-view',
      projectLabel: 'orca',
      agentType: 'claude',
      agentState: 'waiting',
      agentStateLabel: 'Waiting for input',
      responsePreview: 'Need review on stripe colours.',
      latestTimestamp: now - 45_000,
      unread: true,
      parentPaneKey: 'demo:orchestrator'
    },
    {
      paneKey: 'demo:a4',
      paneTitle: 'Wire selection → terminal detail',
      workspaceTitle: 'prototype-new-agents-view',
      projectLabel: 'orca',
      agentType: 'gemini',
      agentState: 'blocked',
      agentStateLabel: 'Blocked',
      responsePreview: 'Blocked on portal target mount.',
      latestTimestamp: now - 90_000,
      unread: false,
      parentPaneKey: 'demo:a2'
    },
    {
      paneKey: 'demo:solo-1',
      paneTitle: 'Explore login race fix',
      workspaceTitle: 'mobile-auth',
      projectLabel: 'app',
      agentType: 'cursor',
      agentState: 'done',
      agentStateLabel: 'Done',
      responsePreview: 'PR opened.',
      latestTimestamp: now - 3_600_000,
      unread: false,
      parentPaneKey: null
    },
    {
      paneKey: 'demo:solo-2',
      paneTitle: 'Docs pass for agents view',
      workspaceTitle: 'prototype-new-agents-view',
      projectLabel: 'orca',
      agentType: 'claude',
      agentState: 'interrupted',
      agentStateLabel: 'Interrupted',
      responsePreview: 'Stopped mid-draft.',
      latestTimestamp: now - 7_200_000,
      unread: false,
      parentPaneKey: null
    }
  ]
}
