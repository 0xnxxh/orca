import { useCallback, type Dispatch, type SetStateAction } from 'react'
import * as Clipboard from 'expo-clipboard'
import type { DiffComment, MobileDiffReviewState } from '../../../src/shared/types'
import type { ConnectionState } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { triggerSuccess } from '../platform/haptics'
import { formatDiffComments, formatMobileDiffReviewPrompt } from './mobile-diff-comments'
import { clearSentMobileDiffComments, markMobileDiffCommentsSent } from './mobile-diff-comment-edit'
import {
  readMobileReviewCreatedTerminal,
  readMobileReviewTerminalSendAccepted,
  readMobileReviewTerminalTabs
} from './mobile-diff-review-rpc'
import { healMobileNativeChatStaleInput } from './mobile-native-chat-stale-input'
import type { ReviewScreenState, SendSheetState } from './mobile-diff-review-screen-model'
import { t } from '@/i18n/mobile-i18n'

type SendActionsInput = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  screenState: ReviewScreenState
  setActionError: Dispatch<SetStateAction<string | null>>
  setSendSheet: Dispatch<SetStateAction<SendSheetState | null>>
  saveCommentsAndReviewState: (
    comments: DiffComment[],
    reviewState: MobileDiffReviewState
  ) => Promise<void>
}

export const MOBILE_DIFF_REVIEW_SEND_TIMEOUT_MS = 30_000

function openMobileDiffReviewSendDeadline(): number {
  return Date.now() + MOBILE_DIFF_REVIEW_SEND_TIMEOUT_MS
}

function remainingRequestBudget(deadline: number, errorMessage: string) {
  const timeoutMs = deadline - Date.now()
  if (timeoutMs <= 0) {
    throw new Error(errorMessage)
  }
  return { timeoutMs, budgetSpansConnect: true as const }
}

export function useMobileDiffReviewSendActions(input: SendActionsInput) {
  const {
    client,
    connState,
    worktreeId,
    screenState,
    setActionError,
    setSendSheet,
    saveCommentsAndReviewState
  } = input

  const copyNotes = useCallback(async () => {
    if (screenState.kind !== 'ready' || screenState.comments.length === 0) {
      return
    }
    await Clipboard.setStringAsync(formatDiffComments(screenState.comments))
    triggerSuccess()
    setActionError(t('m.LtedJAM'))
  }, [screenState, setActionError])

  const clearSentNotes = useCallback(async () => {
    if (screenState.kind !== 'ready') {
      return
    }
    const nextComments = clearSentMobileDiffComments(screenState.comments)
    await saveCommentsAndReviewState(nextComments, screenState.reviewState)
  }, [saveCommentsAndReviewState, screenState])

  const markNotesSent = useCallback(
    async (comments: readonly DiffComment[]) => {
      if (screenState.kind !== 'ready') {
        return
      }
      const next = markMobileDiffCommentsSent(
        screenState.comments,
        new Set(comments.map((comment) => comment.id)),
        Date.now()
      )
      await saveCommentsAndReviewState(next, screenState.reviewState)
    },
    [saveCommentsAndReviewState, screenState]
  )

  const sendPromptToTerminal = useCallback(
    async (
      terminal: string,
      comments: readonly DiffComment[],
      deadline = openMobileDiffReviewSendDeadline()
    ) => {
      if (!client || connState !== 'connected') {
        throw new Error(t('m.x0Dr_H8'))
      }
      // Marked by terminal handle, not by surface, so a paste orphaned here by native
      // chat would ride along with these notes (#10228). Diff review carries no device token.
      if (
        !(await healMobileNativeChatStaleInput({ client, terminal, deviceToken: null, deadline }))
      ) {
        throw new Error(t('m.tpf9SfA'))
      }
      const response = await client.sendRequest(
        'terminal.send',
        {
          terminal,
          text: formatMobileDiffReviewPrompt(comments),
          enter: true
        },
        remainingRequestBudget(deadline, t('m.tpf9SfA'))
      )
      if (!response.ok) {
        throw new Error(response.error?.message || t('m.tpf9SfA'))
      }
      if (!readMobileReviewTerminalSendAccepted(response.result)) {
        throw new Error(t('m.-NMYOgc'))
      }
      await markNotesSent(comments)
      triggerSuccess()
      setActionError(t('m.U2LqmGk'))
      setSendSheet(null)
    },
    [client, connState, markNotesSent, setActionError, setSendSheet]
  )

  const createTerminalAndSend = useCallback(
    async (comments: readonly DiffComment[]) => {
      if (!client || connState !== 'connected') {
        throw new Error(t('m.x0Dr_H8'))
      }
      const deadline = openMobileDiffReviewSendDeadline()
      const response = await client.sendRequest(
        'session.tabs.createTerminal',
        {
          worktree: `id:${worktreeId}`,
          activate: false,
          select: true,
          navigation: 'caller'
        },
        remainingRequestBudget(deadline, t('m.NhC30K0'))
      )
      if (!response.ok) {
        throw new Error(response.error?.message || t('m.NhC30K0'))
      }
      const created = readMobileReviewCreatedTerminal(response.result)
      if (!created) {
        throw new Error(t('m.LYAe0FE'))
      }
      await sendPromptToTerminal(created.terminal, comments, deadline)
    },
    [client, connState, sendPromptToTerminal, worktreeId]
  )

  const openSendSheet = useCallback(async () => {
    if (!client || connState !== 'connected') {
      setActionError(t('m.x0Dr_H8'))
      return
    }
    setSendSheet({ kind: 'loading' })
    try {
      const deadline = openMobileDiffReviewSendDeadline()
      const response = await client.sendRequest(
        'session.tabs.list',
        { worktree: `id:${worktreeId}` },
        remainingRequestBudget(deadline, t('m.vMHt0l8'))
      )
      if (!response.ok) {
        throw new Error(response.error?.message || t('m.vMHt0l8'))
      }
      setSendSheet({ kind: 'ready', terminals: readMobileReviewTerminalTabs(response.result) })
    } catch (err) {
      setSendSheet({
        kind: 'error',
        message: err instanceof Error ? err.message : t('m.vMHt0l8'),
        terminals: []
      })
    }
  }, [client, connState, setActionError, setSendSheet, worktreeId])

  return {
    clearSentNotes,
    copyNotes,
    createTerminalAndSend,
    openSendSheet,
    sendPromptToTerminal
  }
}
