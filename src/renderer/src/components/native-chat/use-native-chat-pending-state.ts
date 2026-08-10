import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import type { NativeChatSession } from '../../../../shared/native-chat-types'
import {
  appendCommandMarkerCache,
  appendPendingSendCache,
  nextNativeChatPendingSendId,
  prunePendingSends,
  readCommandMarkerCache,
  readPendingSendCache,
  writePendingSendCache,
  type NativeChatCommandMarker,
  type NativeChatPendingSend
} from './native-chat-pending'

export function useNativeChatPendingState(args: {
  paneKey: string
  agent: NativeChatSession['agent']
  sessionId: string | null
  messages: NativeChatSession['messages']
  setWorkingInterrupted: Dispatch<SetStateAction<boolean>>
}) {
  const { paneKey, agent, sessionId, messages, setWorkingInterrupted } = args
  const commandMarkerScope = useMemo(
    () => ({ paneKey, agent, sessionId }),
    [paneKey, agent, sessionId]
  )
  const pendingScope = useMemo(() => ({ paneKey, agent }), [paneKey, agent])
  const [pending, setPending] = useState<NativeChatPendingSend[]>(() =>
    readPendingSendCache(pendingScope)
  )
  const [commandMarkers, setCommandMarkers] = useState<NativeChatCommandMarker[]>(() =>
    readCommandMarkerCache(commandMarkerScope)
  )

  useEffect(() => {
    setPending(readPendingSendCache(pendingScope))
    setWorkingInterrupted(false)
  }, [pendingScope, setWorkingInterrupted])
  useEffect(() => {
    setCommandMarkers(readCommandMarkerCache(commandMarkerScope))
    setWorkingInterrupted(false)
  }, [commandMarkerScope, setWorkingInterrupted])
  useEffect(() => {
    setPending((previous) =>
      writePendingSendCache(pendingScope, prunePendingSends(previous, messages))
    )
  }, [messages, pendingScope])

  const onOptimisticSend = useCallback(
    (text: string, imagePaths?: string[]) => {
      setWorkingInterrupted(false)
      const sentAt = Date.now()
      const boundary = messages.at(-1)
      const entry: NativeChatPendingSend = {
        id: nextNativeChatPendingSendId(sentAt),
        text,
        sentAt,
        afterMessageId: boundary?.id ?? null,
        afterMessageTimestamp: boundary?.timestamp ?? null,
        ...(imagePaths ? { imagePaths } : {})
      }
      setPending(appendPendingSendCache(pendingScope, entry))
      return entry.id
    },
    [messages, pendingScope, setWorkingInterrupted]
  )
  const onOptimisticSendCanceled = useCallback(
    (pendingId: string) => {
      const next = readPendingSendCache(pendingScope).filter((entry) => entry.id !== pendingId)
      setPending(writePendingSendCache(pendingScope, next))
    },
    [pendingScope]
  )
  const onSlashCommand = useCallback(
    (command: string) => {
      setCommandMarkers(appendCommandMarkerCache(commandMarkerScope, command))
    },
    [commandMarkerScope]
  )

  return {
    commandMarkers,
    onOptimisticSend,
    onOptimisticSendCanceled,
    onSlashCommand,
    pending,
    pendingScope,
    setPending
  }
}
