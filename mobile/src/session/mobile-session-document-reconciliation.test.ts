import { describe, expect, it } from 'vitest'
import {
  omitRetiredMobileSessionDocuments,
  reconcileChangedMobileMarkdownReads,
  reconcileMobileSessionDocuments
} from './mobile-session-document-reconciliation'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

const fileTab: MobileSessionTab = {
  type: 'file',
  id: 'file-a',
  title: 'a.ts',
  filePath: '/repo/a.ts',
  relativePath: 'a.ts',
  isDirty: false,
  isActive: true
}

const markdownTab: MobileSessionTab = {
  type: 'markdown',
  id: 'markdown-a',
  title: 'a.md',
  filePath: '/repo/a.md',
  relativePath: 'a.md',
  isDirty: false,
  isActive: true,
  documentVersion: 'v1'
}

describe('reconcileMobileSessionDocuments', () => {
  it('retires cached state when a document tab leaves the snapshot', () => {
    const result = reconcileMobileSessionDocuments({
      currentTabs: [fileTab],
      nextTabs: [],
      markdownDocs: new Map(),
      activeTabId: fileTab.id
    })

    expect(result.retiredTabIds).toEqual(new Set([fileTab.id]))
    expect(result.changedReadTabIds).toEqual(new Set())
    expect(
      omitRetiredMobileSessionDocuments(new Map([[fileTab.id, 'loading']]), result.retiredTabIds)
    ).toEqual(new Map())
  })

  it('keeps an orphaned dirty markdown draft out of retirement', () => {
    const draft: MarkdownDocState = {
      status: 'ready',
      content: '# Draft',
      localContent: '# Changed',
      baseVersion: 'v1',
      isDirty: true,
      editable: true
    }
    const result = reconcileMobileSessionDocuments({
      currentTabs: [markdownTab],
      nextTabs: [],
      markdownDocs: new Map([[markdownTab.id, draft]]),
      activeTabId: markdownTab.id
    })

    expect(result.tabs).toEqual([markdownTab])
    expect(result.retiredTabIds).toEqual(new Set())
  })

  it('invalidates a read when the same markdown tab advances versions', () => {
    const result = reconcileMobileSessionDocuments({
      currentTabs: [markdownTab],
      nextTabs: [{ ...markdownTab, documentVersion: 'v2', isDirty: true }],
      markdownDocs: new Map([[markdownTab.id, { status: 'loading' }]]),
      activeTabId: markdownTab.id
    })

    expect(result.retiredTabIds).toEqual(new Set())
    expect(result.changedReadTabIds).toEqual(new Set([markdownTab.id]))
    expect(
      reconcileChangedMobileMarkdownReads(
        new Map([[markdownTab.id, { status: 'loading' }]]),
        result.changedReadTabIds
      )
    ).toEqual(new Map())
  })

  it('retains a local markdown draft as stale when the host document changes', () => {
    const draft: MarkdownDocState = {
      status: 'ready',
      content: '# Original',
      localContent: '# Phone draft',
      baseVersion: 'v1',
      isDirty: true,
      editable: true
    }

    expect(
      reconcileChangedMobileMarkdownReads(
        new Map([[markdownTab.id, draft]]),
        new Set([markdownTab.id])
      )
    ).toEqual(new Map([[markdownTab.id, { ...draft, stale: true }]]))
  })

  it('invalidates a file read when a stable tab id changes preview target', () => {
    const result = reconcileMobileSessionDocuments({
      currentTabs: [fileTab],
      nextTabs: [{ ...fileTab, filePath: '/repo/b.ts', relativePath: 'b.ts' }],
      markdownDocs: new Map(),
      activeTabId: fileTab.id
    })

    expect(result.changedReadTabIds).toEqual(new Set([fileTab.id]))
  })
})
