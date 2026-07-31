type RpcRequestBudgetOptions = {
  timeoutMs?: number
  budgetSpansConnect?: boolean
  strictDeadline?: boolean
}

export type RpcRequestBudget = {
  startedAt: number
  timeoutMs?: number
  deadline: number | null
  strictDeadline: boolean
}

export const RPC_REQUEST_MIN_ACK_MS = 1_000

export function openRpcRequestBudget(
  options?: RpcRequestBudgetOptions,
  now = Date.now()
): RpcRequestBudget {
  const timeoutMs = options?.timeoutMs
  return {
    startedAt: now,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    deadline: options?.budgetSpansConnect && timeoutMs !== undefined ? now + timeoutMs : null,
    strictDeadline: options?.strictDeadline === true
  }
}

export function resolvePostConnectRequestTimeout(
  budget: RpcRequestBudget,
  fallbackMs: number,
  now = Date.now()
): number {
  if (budget.deadline === null) {
    return budget.timeoutMs ?? fallbackMs
  }
  const remainingMs = budget.deadline - now
  if (budget.strictDeadline) {
    return Math.max(0, remainingMs)
  }
  return Math.max(Math.min(RPC_REQUEST_MIN_ACK_MS, budget.deadline - budget.startedAt), remainingMs)
}
