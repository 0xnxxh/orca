import { win32 } from 'node:path'
import { getLauncherBaseName, isWindowsBatchLauncher } from './editor-launcher-name'

// Why: JetBrains installers ship `*64.exe` GUI-subsystem binaries. The
// Toolbox/installer `.cmd`/`.bat` shims chain through console helpers
// (`java.exe`) that allocate a visible Command Prompt even when the parent
// spawn uses windowsHide — the STA-3040 "prompt window" loop on Windows.
// Maps each console launcher name to its GUI sibling.
const JETBRAINS_WINDOWS_GUI_LAUNCHERS: Readonly<Record<string, string>> = {
  idea: 'idea64',
  webstorm: 'webstorm64',
  pycharm: 'pycharm64',
  phpstorm: 'phpstorm64',
  goland: 'goland64',
  rider: 'rider64',
  clion: 'clion64',
  rubymine: 'rubymine64',
  datagrip: 'datagrip64',
  rustrover: 'rustrover64',
  studio: 'studio64'
}

const JETBRAINS_WINDOWS_GUI_EXECUTABLES = new Set(Object.values(JETBRAINS_WINDOWS_GUI_LAUNCHERS))

function getGuiExecutableName(launcherBaseName: string): string | null {
  if (JETBRAINS_WINDOWS_GUI_EXECUTABLES.has(launcherBaseName)) {
    return launcherBaseName
  }
  return JETBRAINS_WINDOWS_GUI_LAUNCHERS[launcherBaseName] ?? null
}

/**
 * The GUI `*64.exe` beside an already-resolved console shim, or null.
 *
 * Why sibling-only: a bare PATH lookup for `idea64` can land in a different,
 * stale install, and it costs a second full PATH walk on Electron's main
 * thread. Toolbox script directories ship no exe, so those keep the shim and
 * rely on the detached-GUI spawn instead.
 */
export function resolveColocatedJetBrainsGuiExecutable(
  resolvedCommand: string,
  fileExists: (path: string) => boolean
): string | null {
  if (!isWindowsBatchLauncher(resolvedCommand)) {
    return null
  }
  const guiName = getGuiExecutableName(getLauncherBaseName(resolvedCommand))
  if (!guiName) {
    return null
  }
  const candidate = win32.join(win32.dirname(resolvedCommand), `${guiName}.exe`)
  return fileExists(candidate) ? candidate : null
}

// Why: only JetBrains shims chain through console helpers that outlive the
// batch and re-open a prompt. Other GUI shims (code.cmd, cursor.cmd) exit on
// their own, and running them under `start` would re-parse their quoted
// WSL/SSH remote argv.
export function isJetBrainsConsoleShim(command: string, platform: NodeJS.Platform): boolean {
  return (
    platform === 'win32' &&
    isWindowsBatchLauncher(command) &&
    getGuiExecutableName(getLauncherBaseName(command)) !== null
  )
}
