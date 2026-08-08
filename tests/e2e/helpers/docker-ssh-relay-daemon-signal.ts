import type { DockerSshRelayDaemonSnapshot } from './docker-ssh-relay-processes'
import {
  execDockerSshRelayTargetCommand,
  shellQuote,
  type DockerSshRelayTarget
} from './docker-ssh-relay-target'

export function signalDockerSshRelayDaemon(
  target: DockerSshRelayTarget,
  snapshot: DockerSshRelayDaemonSnapshot,
  signal: 'TERM' | 'KILL'
): void {
  const { relayPid, relayDir, role, socketPath, authorityProcessToken } = snapshot
  if (!Number.isInteger(relayPid)) {
    throw new Error('Docker SSH relay process ID must be an integer')
  }
  if (role === 'legacy-combined') {
    throw new Error('Role-specific authority tests cannot signal a legacy combined relay')
  }
  const roleFlag = role === 'terminal-authority' ? '--terminal-authority' : '--control-adapter'
  const identityChecks = [
    `proc=/proc/${relayPid}`,
    '[ -r "$proc/cmdline" ]',
    'argv=()',
    'mapfile -d \'\' -t argv < "$proc/cmdline"',
    '[ "${argv[1]##*/}" = relay.js ]',
    '[[ " ${argv[*]:2} " = *" --detached "* ]]',
    `[[ " \${argv[*]:2} " = *" ${roleFlag} "* ]]`,
    `[ "$(readlink "$proc/cwd")" = ${shellQuote(relayDir)} ]`,
    `expected_socket=${shellQuote(socketPath)}`,
    'matched_socket=no',
    'for ((i=2; i<${#argv[@]}; i++)); do if [ "${argv[$i]}" = --sock-path ] && [ "${argv[$((i+1))]:-}" = "$expected_socket" ]; then matched_socket=yes; fi; done',
    '[ "$matched_socket" = yes ]'
  ]
  if (role === 'terminal-authority') {
    if (!authorityProcessToken) {
      throw new Error('Terminal authority snapshot has no process token')
    }
    identityChecks.push(
      `expected_token=${shellQuote(authorityProcessToken)}`,
      'matched_token=no',
      'for ((i=2; i<${#argv[@]}; i++)); do if [ "${argv[$i]}" = --authority-process-token ] && [ "${argv[$((i+1))]:-}" = "$expected_token" ]; then matched_token=yes; fi; done',
      '[ "$matched_token" = yes ]'
    )
  }
  execDockerSshRelayTargetCommand(
    target,
    [...identityChecks, `kill -${signal} ${relayPid}`].join(' && ')
  )
}
