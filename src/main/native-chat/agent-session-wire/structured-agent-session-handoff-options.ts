import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'

export async function readNativeHandoffSessionOptions(input: {
  adapter: Pick<StructuredAgentSessionAdapter, 'readOptions'>
  sessionId: string
  fence: number
}): Promise<Readonly<Record<string, string>> | undefined> {
  const { adapter, sessionId, fence } = input
  const reported = await adapter.readOptions?.({
    sessionId,
    fence
  })
  if (!reported) {
    return undefined
  }
  return {
    model: reported.current.model,
    ...(reported.current.effort ? { effort: reported.current.effort } : {})
  }
}
