import { describe, expect, it } from 'vitest'

import {
  buildActivityThreadLineageItems,
  resolveActivityThreadParentPaneKey,
  type ActivityLineageThreadLike
} from './activity-thread-lineage'

function thread(
  partial: Partial<ActivityLineageThreadLike> & Pick<ActivityLineageThreadLike, 'paneKey'>
): ActivityLineageThreadLike {
  return {
    paneTitle: partial.paneTitle ?? partial.paneKey,
    terminalHandle: partial.terminalHandle ?? null,
    parentPaneKey: partial.parentPaneKey ?? null,
    parentTerminalHandle: partial.parentTerminalHandle ?? null,
    coordinatorHandle: partial.coordinatorHandle ?? null,
    ...partial
  }
}

describe('buildActivityThreadLineageItems', () => {
  it('nests children under parents and reports relationship metadata', () => {
    const items = buildActivityThreadLineageItems([
      thread({ paneKey: 'child-b', paneTitle: 'Worker B', parentPaneKey: 'root' }),
      thread({ paneKey: 'root', paneTitle: 'Coordinator' }),
      thread({ paneKey: 'child-a', paneTitle: 'Worker A', parentPaneKey: 'root' }),
      thread({ paneKey: 'solo', paneTitle: 'Solo' })
    ])

    expect(items.map((item) => item.thread.paneKey)).toEqual(['root', 'child-b', 'child-a', 'solo'])
    expect(items[0]?.lineage).toMatchObject({
      depth: 0,
      childCount: 2,
      parentTitle: null
    })
    expect(items[1]?.lineage).toMatchObject({
      depth: 1,
      parentPaneKey: 'root',
      parentTitle: 'Coordinator',
      isFirstSibling: true,
      isLastSibling: false
    })
    expect(items[2]?.lineage).toMatchObject({
      depth: 1,
      parentTitle: 'Coordinator',
      isFirstSibling: false,
      isLastSibling: true
    })
    expect(items[3]?.lineage.depth).toBe(0)
  })

  it('resolves parent via terminal handle when pane key is missing', () => {
    const parent = thread({
      paneKey: 'parent',
      paneTitle: 'Parent',
      terminalHandle: 'term_parent'
    })
    const child = thread({
      paneKey: 'child',
      paneTitle: 'Child',
      parentTerminalHandle: 'term_parent'
    })
    const byPaneKey = new Map([
      [parent.paneKey, parent],
      [child.paneKey, child]
    ])
    const byHandle = new Map([['term_parent', 'parent']])
    expect(resolveActivityThreadParentPaneKey(child, byPaneKey, byHandle)).toBe('parent')

    const items = buildActivityThreadLineageItems([child, parent])
    expect(items.map((item) => item.thread.paneKey)).toEqual(['parent', 'child'])
    expect(items[1]?.lineage.parentTitle).toBe('Parent')
  })

  it('keeps cycle participants visible as roots', () => {
    const items = buildActivityThreadLineageItems([
      thread({ paneKey: 'a', parentPaneKey: 'b' }),
      thread({ paneKey: 'b', parentPaneKey: 'a' })
    ])
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.lineage.depth === 0)).toBe(true)
  })
})
