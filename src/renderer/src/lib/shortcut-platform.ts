/** Maps a user agent to the platform whose conventions the renderer should follow. */
export function resolveShortcutPlatform(userAgent: string): NodeJS.Platform {
  if (userAgent.includes('Mac')) {
    return 'darwin'
  }
  return userAgent.includes('Windows') ? 'win32' : 'linux'
}

export function getShortcutPlatform(): NodeJS.Platform {
  return resolveShortcutPlatform(navigator.userAgent)
}
