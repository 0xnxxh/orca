import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'

// Why: a create in flight when the mobile transport migrates (relay→direct
// hand-off on cellular) rejects client-side with a cutover error even though the
// host may still complete it — the desktop never logs a trace, the user just
// sees "Couldn't run <quick command>". The host has deduped
// session.tabs.createTerminal by clientMutationId since before it advertised
// terminal.quick-commands.v1, so replaying the same params on the fresh session
// is idempotent. Mirrors sendWorktreeCreateResilient in tasks/worktree-create-retry.ts.
const SESSION_TERMINAL_CREATE_CUTOVER_MAX_RETRIES = 5

export async function sendSessionTerminalCreateResilient(
  client: RpcClient,
  params: Record<string, unknown>,
  opts: { hostDedupesTerminalCreates: boolean }
): Promise<RpcResponse> {
  for (let migrationRetry = 0; ; migrationRetry += 1) {
    try {
      return await client.sendRequest('session.tabs.createTerminal', params)
    } catch (error) {
      if (
        !opts.hostDedupesTerminalCreates ||
        !isLogicalClientCutoverError(error) ||
        migrationRetry >= SESSION_TERMINAL_CREATE_CUTOVER_MAX_RETRIES
      ) {
        throw error
      }
      // Why: LogicalClientCutoverError is raised only after migrateTo installs an
      // authenticated replacement session, so retry immediately instead of backing off.
    }
  }
}
