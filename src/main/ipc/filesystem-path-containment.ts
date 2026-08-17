import { resolve, relative, isAbsolute, sep } from 'node:path'
import { realpath } from 'node:fs/promises'

/**
 * Check whether resolvedTarget is equal to or a descendant of resolvedBase.
 * Uses relative() so it works with both `/` (Unix) and `\` (Windows) separators.
 */
export function isDescendantOrEqual(resolvedTarget: string, resolvedBase: string): boolean {
  if (resolvedTarget === resolvedBase) {
    return true
  }
  const rel = relative(resolvedBase, resolvedTarget)
  // Security: reject "..", "../…" or an absolute rel — on Windows relative() returns absolute across drives, which would bypass drive-traversal checks.
  // Use isAbsolute, not rejoin+compare: Windows path.relative() ignores drive/root casing, so rejoining would deny valid c:\repo under C:\Repo.
  return rel !== '' && !(rel === '..' || rel.startsWith(`..${sep}`)) && !isAbsolute(rel)
}

/**
 * Returns true if the error is an ENOENT (file-not-found) error.
 */
/**
 * Node's canonical ENOENT message. Matched in full so a message that merely mentions the word — a
 * log line, a user's branch name — cannot be mistaken for a missing path.
 */
const ENOENT_MESSAGE = /\bENOENT: no such file or directory\b/

export function isENOENT(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  if ('code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
    return true
  }
  // Why the message is also consulted: an error raised on an SSH host crosses the relay as JSON-RPC,
  // and ssh-channel-multiplexer rebuilds it with the TRANSPORT's numeric code (msg.error.code), so
  // Node's 'ENOENT' string code no longer exists on the object by the time any caller sees it. Every
  // caller here asks the same question — "is this path simply absent?" — and for a remote path the
  // answer was unreachable: remotePathExists rethrew instead of returning false, which surfaced as a
  // raw "ENOENT: no such file or directory, lstat '<path>'" when creating a worktree over SSH.
  return ENOENT_MESSAGE.test(error.message)
}

export async function normalizeExistingPath(resolvedPath: string): Promise<string> {
  try {
    return resolve(await realpath(resolvedPath))
  } catch (error) {
    if (isENOENT(error)) {
      return resolvedPath
    }
    throw error
  }
}

export function validateGitRelativeFilePath(worktreePath: string, filePath: string): string {
  if (!filePath || filePath.includes('\0') || resolve(filePath) === filePath) {
    throw new Error('Access denied: invalid git file path')
  }

  const resolvedFilePath = resolve(worktreePath, filePath)
  if (!isDescendantOrEqual(resolvedFilePath, worktreePath)) {
    throw new Error('Access denied: git file path escapes the selected worktree')
  }

  const normalizedRelativePath = relative(worktreePath, resolvedFilePath)
  if (!normalizedRelativePath) {
    throw new Error('Access denied: invalid git file path')
  }

  return normalizedRelativePath
}
