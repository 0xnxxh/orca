export type LegacyPhysicalWorkerPtyIdentity = Readonly<{
  id: string
  incarnationId: string
}>

export type LegacyPhysicalWorkerMutation =
  | Readonly<{ kind: 'data'; data: string }>
  | Readonly<{ kind: 'resize'; cols: number; rows: number }>
  | Readonly<{ kind: 'signal'; signal: string }>
  | Readonly<{ kind: 'clear' }>
  | Readonly<{ kind: 'shutdown'; immediate: boolean; keepHistory?: boolean }>

type MutationRpc = Readonly<{
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  notify: (method: string, params: Record<string, unknown>) => void
}>

export async function dispatchVerifiedLegacyPhysicalWorkerMutation(
  rpc: MutationRpc,
  mode: 'exact-v1' | 'legacy-fenced-v1',
  pty: LegacyPhysicalWorkerPtyIdentity,
  mutation: LegacyPhysicalWorkerMutation
): Promise<boolean> {
  if (mutation.kind === 'data' || mutation.kind === 'resize') {
    rpc.notify(
      mode === 'exact-v1'
        ? mutation.kind === 'data'
          ? 'pty.dataExact'
          : 'pty.resizeExact'
        : mutation.kind === 'data'
          ? 'pty.data'
          : 'pty.resize',
      mutationParams(pty, mutation, mode === 'exact-v1')
    )
    return true
  }
  const method = mutationMethod(mode, mutation.kind)
  const result = await rpc.request(method, mutationParams(pty, mutation, mode === 'exact-v1'))
  return mode === 'legacy-fenced-v1' || acceptedExactMutation(result)
}

function mutationMethod(
  mode: 'exact-v1' | 'legacy-fenced-v1',
  kind: 'signal' | 'clear' | 'shutdown'
): string {
  const suffix = mode === 'exact-v1' ? 'Exact' : ''
  return {
    signal: `pty.sendSignal${suffix}`,
    clear: `pty.clearBuffer${suffix}`,
    shutdown: `pty.shutdown${suffix}`
  }[kind]
}

function mutationParams(
  pty: LegacyPhysicalWorkerPtyIdentity,
  mutation: LegacyPhysicalWorkerMutation,
  exact: boolean
): Record<string, unknown> {
  const identity = exact ? pty : { id: pty.id }
  if (mutation.kind === 'data') {
    return { ...identity, data: mutation.data }
  }
  if (mutation.kind === 'resize') {
    return { ...identity, cols: mutation.cols, rows: mutation.rows }
  }
  if (mutation.kind === 'signal') {
    return { ...identity, signal: mutation.signal }
  }
  return mutation.kind === 'shutdown'
    ? {
        ...identity,
        immediate: mutation.immediate,
        ...(mutation.keepHistory !== undefined ? { keepHistory: mutation.keepHistory } : {})
      }
    : identity
}

function acceptedExactMutation(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { accepted?: unknown }).accepted === true
  )
}
