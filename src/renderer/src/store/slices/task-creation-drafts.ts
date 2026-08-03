import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

/** In-progress New Linear issue / New Linear project / New Jira issue composer
 *  drafts. Session-only (never `persist`-wrapped, no disk surface): they exist
 *  so an accidental dismissal (outside click / Escape / Cancel) doesn't discard
 *  typed text, and are cleared on a successful submit or app restart. Mirrors
 *  `newIssueDraft` (GitHub) but text-only — picker selections keep their
 *  existing open-time defaults. */
export type NewLinearIssueDraft = { title: string; body: string }
export type NewLinearProjectDraft = { name: string; description: string; content: string }
export type NewJiraIssueDraft = { title: string; body: string }

/** A draft is worth keeping only once some field carries real typed text; a
 *  whitespace-only form never pins a draft, so an "opened but never edited"
 *  dialog can't hijack a later open. Shared by every write-through gate so
 *  mirror and clear agree on "has content". */
export function isTaskCreationDraftContentful(fields: Record<string, string>): boolean {
  return Object.values(fields).some((value) => value.trim().length > 0)
}

export type TaskCreationDraftsSlice = {
  newLinearIssueDraft: NewLinearIssueDraft | null
  setNewLinearIssueDraft: (draft: NewLinearIssueDraft) => void
  clearNewLinearIssueDraft: () => void
  newLinearProjectDraft: NewLinearProjectDraft | null
  setNewLinearProjectDraft: (draft: NewLinearProjectDraft) => void
  clearNewLinearProjectDraft: () => void
  newJiraIssueDraft: NewJiraIssueDraft | null
  setNewJiraIssueDraft: (draft: NewJiraIssueDraft) => void
  clearNewJiraIssueDraft: () => void
}

export const createTaskCreationDraftsSlice: StateCreator<
  AppState,
  [],
  [],
  TaskCreationDraftsSlice
> = (set) => ({
  newLinearIssueDraft: null,
  setNewLinearIssueDraft: (draft) => set({ newLinearIssueDraft: draft }),
  clearNewLinearIssueDraft: () => set({ newLinearIssueDraft: null }),
  newLinearProjectDraft: null,
  setNewLinearProjectDraft: (draft) => set({ newLinearProjectDraft: draft }),
  clearNewLinearProjectDraft: () => set({ newLinearProjectDraft: null }),
  newJiraIssueDraft: null,
  setNewJiraIssueDraft: (draft) => set({ newJiraIssueDraft: draft }),
  clearNewJiraIssueDraft: () => set({ newJiraIssueDraft: null })
})
