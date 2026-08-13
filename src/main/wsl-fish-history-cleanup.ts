import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isSafeFishHistorySession } from './fish-history-session'

const execFileAsync = promisify(execFile)
let cleanupTail = Promise.resolve()

export function deleteWslFishHistoryFile(
  distro: string,
  session: string,
  run: typeof execFileAsync = execFileAsync
): Promise<void> {
  if (!distro.trim() || !isSafeFishHistorySession(session)) {
    return Promise.resolve()
  }
  const script = [
    'set -l data_home $XDG_DATA_HOME',
    'string match -qr "^/" -- $data_home; or set data_home "$HOME/.local/share"',
    `command rm -f -- "$data_home/fish/${session}_history"`
  ].join('; ')
  // Why: startup may discover many durable tombstones, but wsl.exe cleanup fanout must stay at one.
  const cleanup = cleanupTail.then(async () => {
    await run('wsl.exe', ['--distribution', distro, '--exec', 'fish', '--command', script], {
      timeout: 5_000,
      windowsHide: true
    })
  })
  cleanupTail = cleanup.catch(() => undefined)
  return cleanup
}
