// Why: every Windows hook command that reaches a consumer as a single string is built here, so the
// window-suppression switch cannot be present in one installer and missing in another (#14815).

// Why: PATH lookup lets a worktree-local exe hijack hook payloads.
// Forward slashes keep this absolute path shell-friendly for cmd.exe and Git Bash.
export function getWindowsSystem32Path(relativePath: string): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return `${systemRoot.replaceAll('\\', '/')}/System32/${relativePath}`
}

export function getWindowsPowerShellExecutablePath(): string {
  return getWindowsSystem32Path('WindowsPowerShell/v1.0/powershell.exe')
}

// Why: `conhost.exe --headless` (#13443) does not wait for the hosted process and relays neither its
// exit code nor its stdout — it implements the ConPTY server protocol, not a generic no-window
// wrapper — so it silently discarded whatever the hook wrote (#14818). `-WindowStyle Hidden`
// suppresses the window while leaving wait, exit code, and stdout relay intact.
export const WINDOWS_POWERSHELL_HOOK_SWITCHES =
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden'

// Why: with stderr redirected, PowerShell serializes progress records to it as CLIXML
// (`#< CLIXML...`). A consumer that merges stderr into stdout then sees those bytes ahead of the
// hook's JSON and fails to parse it — the same failure mode as #14818, from a different stream.
// Silencing progress keeps both streams clean for every hook payload.
const HOOK_PROGRESS_SILENCER = "$ProgressPreference='SilentlyContinue'; "

// Why: base64 keeps the script path out of the command line entirely, so neither cmd.exe nor Git
// Bash/MSYS can mangle it — MSYS rewrites `/`-prefixed switches into paths and collapses backslash
// drive paths, and cmd.exe reads a forward-slash path as a switch (#6078, #14815).
export function encodeWindowsPowerShellHookCommand(command: string): string {
  return Buffer.from(`${HOOK_PROGRESS_SILENCER}${command}`, 'utf16le').toString('base64')
}

export function wrapWindowsPowerShellEncodedCommand(command: string): string {
  return `${getWindowsPowerShellExecutablePath()} ${WINDOWS_POWERSHELL_HOOK_SWITCHES} -EncodedCommand ${encodeWindowsPowerShellHookCommand(command)}`
}
