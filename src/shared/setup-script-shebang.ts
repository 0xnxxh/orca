// Why: the interpreter a setup/issue-command script is written for is a property of the script,
// not of the user's terminal preference, so a `#!` line is how a project declares it.

const POSIX_SHELL_BASENAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash'])

/** True when `line` is a `#!` interpreter line (leading whitespace tolerated). */
export function isShebangLine(line: string): boolean {
  return line.trimStart().startsWith('#!')
}

/** True when the script's first line is a `#!` line naming a POSIX shell. */
export function scriptDeclaresPosixShell(script: string): boolean {
  const firstLine = script.split('\n', 1)[0] ?? ''
  if (!isShebangLine(firstLine)) {
    return false
  }

  const tokens = firstLine.trim().slice(2).trim().split(/\s+/).filter(Boolean)
  const interpreter = shebangInterpreterBasename(tokens)
  return interpreter !== null && POSIX_SHELL_BASENAMES.has(interpreter)
}

function shebangInterpreterBasename(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index++) {
    const basename = executableBasename(tokens[index])
    // Why: `env` (and its `-S` split-string form) only forwards to the real interpreter.
    if (basename === 'env' || basename.startsWith('-')) {
      continue
    }
    return basename || null
  }
  return null
}

function executableBasename(token: string): string {
  return (
    token
      .replaceAll('\\', '/')
      .split('/')
      .pop()
      ?.toLowerCase()
      .replace(/\.exe$/, '') ?? ''
  )
}
