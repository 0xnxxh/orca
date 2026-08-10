import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { lowerRelayAiVaultServicePriority } from './ai-vault-service-priority'

export function relayAiVaultServiceEntryPath(baseDir = __dirname): string {
  return join(baseDir, 'relay-ai-vault-service.js')
}

export function spawnRelayAiVaultService(): ChildProcess {
  const child = fork(relayAiVaultServiceEntryPath(), [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv: ['--max-old-space-size=384'],
    ...(process.platform === 'win32' ? { windowsHide: true } : {})
  })
  lowerRelayAiVaultServicePriority(child.pid)
  child.unref()
  return child
}
