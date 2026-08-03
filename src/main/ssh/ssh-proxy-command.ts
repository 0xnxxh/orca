import { spawn, type ChildProcess } from 'node:child_process'
import { Duplex } from 'node:stream'
import type { Socket as NetSocket } from 'node:net'
import type { SshTarget } from '../../shared/ssh-types'
import type { SshResolvedConfig } from './ssh-config-parser'
import { shellEscape } from './ssh-connection-utils'
import { isOpenSshConfigBackedTarget } from './system-ssh-args'

// Why: ProxyJump and jumpHost are syntactic sugar for ProxyCommand.
// OpenSSH internally converts `ProxyJump bastion` to
// `ProxyCommand ssh -W %h:%p bastion`. We do the same so that ssh2
// gets a single proxy spawn path regardless of how the tunnel was configured.
export type EffectiveProxy =
  | { kind: 'proxy-command'; command: string }
  | { kind: 'jump-host'; jumpHost: string }

export function resolveEffectiveProxy(
  target: SshTarget,
  resolved: SshResolvedConfig | null
): EffectiveProxy | undefined {
  if (isOpenSshConfigBackedTarget(target) && resolved) {
    if (resolved.proxyCommand) {
      return { kind: 'proxy-command', command: resolved.proxyCommand }
    }
    return resolved.proxyJump ? { kind: 'jump-host', jumpHost: resolved.proxyJump } : undefined
  }
  if (target.proxyCommand) {
    return { kind: 'proxy-command', command: target.proxyCommand }
  }
  if (resolved?.proxyCommand) {
    return { kind: 'proxy-command', command: resolved.proxyCommand }
  }
  const jump = target.jumpHost || resolved?.proxyJump
  if (jump) {
    return { kind: 'jump-host', jumpHost: jump }
  }
  return undefined
}

function cmdEscape(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

// Why: ssh2 doesn't natively support ProxyCommand. When the SSH config
// specifies one (e.g. `cloudflared access ssh --hostname %h`), we spawn
// the command and bridge its stdin/stdout into a Duplex stream that ssh2
// uses as its transport socket via `config.sock`.
function getShellSpawnConfig(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe'
    return { file: comspec, args: ['/d', '/s', '/c', command] }
  }
  return { file: '/bin/sh', args: ['-c', command] }
}

export function spawnProxyCommand(
  proxy: EffectiveProxy,
  host: string,
  port: number,
  user: string
): { process: ChildProcess; sock: NetSocket } {
  const proc =
    proxy.kind === 'jump-host'
      ? // Why: ProxyJump is structured input, not a shell snippet. Spawn ssh
        // directly so jump-host values cannot escape through shell parsing.
        spawn('ssh', ['-W', `${host}:${port}`, '--', proxy.jumpHost], {
          stdio: ['pipe', 'pipe', 'pipe']
        })
      : (() => {
          const escape = process.platform === 'win32' ? cmdEscape : shellEscape
          const expanded = proxy.command
            .replace(/%h/g, escape(host))
            .replace(/%p/g, escape(String(port)))
            .replace(/%r/g, escape(user))
          const shell = getShellSpawnConfig(expanded)
          return spawn(shell.file, shell.args, { stdio: ['pipe', 'pipe', 'pipe'] })
        })()

  // Why: a single PassThrough for both directions creates a feedback loop.
  // Reads come from the proxy's stdout; writes go to its stdin.
  let cleanedUp = false
  const cleanup = (): void => {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    proc.stdout!.off('data', onStdoutData)
    proc.stdout!.off('end', onStdoutEnd)
    proc.stdin!.off('error', onInputError)
    proc.off('error', onProcessError)
  }
  const onStdoutData = (data: Buffer): void => {
    stream.push(data)
  }
  const onStdoutEnd = (): void => {
    stream.push(null)
  }
  const onInputError = (err: Error): void => {
    stream.destroy(err)
  }
  const onProcessError = (err: Error): void => {
    stream.destroy(err)
  }
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, cb) {
      proc.stdin!.write(chunk, cb)
    },
    destroy(err, cb) {
      cleanup()
      cb(err)
    }
  })
  proc.stdout!.on('data', onStdoutData)
  proc.stdout!.on('end', onStdoutEnd)
  proc.stdin!.on('error', onInputError)
  proc.on('error', onProcessError)

  return { process: proc, sock: stream as unknown as NetSocket }
}
