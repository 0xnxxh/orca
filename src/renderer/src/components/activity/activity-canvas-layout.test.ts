import { describe, expect, it } from 'vitest'

import {
  assignAgentLooks,
  layoutActivityCanvas,
  type ActivityCanvasThreadInput
} from './activity-canvas-layout'
import { buildDemoCanvasThreads } from './activity-canvas-demo-threads'

function thread(
  partial: Partial<ActivityCanvasThreadInput> & Pick<ActivityCanvasThreadInput, 'paneKey'>
): ActivityCanvasThreadInput {
  return {
    paneTitle: partial.paneTitle ?? partial.paneKey,
    workspaceTitle: partial.workspaceTitle ?? 'ws',
    projectLabel: partial.projectLabel ?? 'proj',
    agentType: partial.agentType ?? 'claude',
    agentState: partial.agentState ?? 'working',
    agentStateLabel: partial.agentStateLabel ?? 'Working',
    responsePreview: partial.responsePreview ?? '',
    latestTimestamp: partial.latestTimestamp ?? 1,
    unread: partial.unread ?? false,
    parentPaneKey: partial.parentPaneKey ?? null,
    ...partial
  }
}

describe('layoutActivityCanvas', () => {
  it('packs agents with no edges into an isolated cluster', () => {
    const layout = layoutActivityCanvas([
      thread({ paneKey: 'a', latestTimestamp: 3 }),
      thread({ paneKey: 'b', latestTimestamp: 2 }),
      thread({ paneKey: 'c', latestTimestamp: 1 })
    ])
    expect(layout.linkedCount).toBe(0)
    expect(layout.isolatedCount).toBe(3)
    expect(layout.edges).toHaveLength(0)
    expect(layout.clusters).toHaveLength(1)
    expect(layout.nodes.every((n) => n.isolated)).toBe(true)
  })

  it('places parent above children and draws parent→child edges', () => {
    const layout = layoutActivityCanvas([
      thread({ paneKey: 'root', parentPaneKey: null }),
      thread({ paneKey: 'child-1', parentPaneKey: 'root' }),
      thread({ paneKey: 'child-2', parentPaneKey: 'root' })
    ])
    expect(layout.linkedCount).toBe(3)
    expect(layout.isolatedCount).toBe(0)
    expect(layout.edges).toHaveLength(2)

    const root = layout.nodes.find((n) => n.id === 'root')!
    const child1 = layout.nodes.find((n) => n.id === 'child-1')!
    const child2 = layout.nodes.find((n) => n.id === 'child-2')!
    expect(root.y).toBeLessThan(child1.y)
    expect(root.y).toBeLessThan(child2.y)
    expect(root.isolated).toBe(false)
  })

  it('ignores parentPaneKey when the parent is not in the thread set', () => {
    const layout = layoutActivityCanvas([
      thread({ paneKey: 'orphan', parentPaneKey: 'missing-parent' })
    ])
    expect(layout.isolatedCount).toBe(1)
    expect(layout.edges).toHaveLength(0)
  })

  it('assigns stable monograms with roots before children', () => {
    const looks = assignAgentLooks([
      thread({ paneKey: 'child', parentPaneKey: 'root' }),
      thread({ paneKey: 'root', parentPaneKey: null }),
      thread({ paneKey: 'solo', parentPaneKey: null })
    ])
    expect(looks.get('root')?.monogram).toMatch(/^A\d+$/)
    expect(looks.get('solo')?.monogram).toMatch(/^A\d+$/)
    expect(looks.get('child')?.monogram).toMatch(/^A\d+$/)
    // Roots sort before children; root + solo come first alphabetically as roots.
    expect(looks.get('root')!.index).toBeLessThan(looks.get('child')!.index)
  })

  it('lays out the demo sample without empty geometry', () => {
    const layout = layoutActivityCanvas(buildDemoCanvasThreads())
    expect(layout.nodes.length).toBeGreaterThan(3)
    expect(layout.edges.length).toBeGreaterThan(0)
    expect(layout.width).toBeGreaterThan(200)
    expect(layout.height).toBeGreaterThan(200)
  })
})
