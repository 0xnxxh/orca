// Why: sequential relay teardown calls share one absolute budget; convert only at dispatch.
export function sshRelayDeadlineOptions(
  deadlineMs: number | undefined
): { timeoutMs: number } | undefined {
  return deadlineMs === undefined ? undefined : { timeoutMs: Math.max(1, deadlineMs - Date.now()) }
}
