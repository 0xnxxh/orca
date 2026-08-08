import { shellEscape } from './ssh-connection-utils'
import { relayHookEndpointDirForHost } from './ssh-relay-endpoints'
import { commandWithNodePath } from './ssh-remote-commands'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral, powerShellNativeArg } from './ssh-remote-powershell'
import type { SshTerminalAuthorityEndpointIdentity } from '../../shared/ssh-terminal-authority-marker'
import type { SshTerminalAuthorityTakeover } from './ssh-terminal-authority-admission'
import type { SshTerminalAuthorityEndpoint } from './ssh-terminal-authority-endpoint'

export const AUTHORITY_READY_TIMEOUT_MS = 10_000
export const AUTHORITY_READY_INTERVAL_MS = 100

function relayScript(host: RemoteHostPlatform, relayDir: string): string {
  return joinRemotePath(host, relayDir, 'relay.js')
}

export function sshTerminalAuthorityConnectCommand(args: {
  host: RemoteHostPlatform
  nodePath: string
  ownerRelayDir: string
  endpoint: SshTerminalAuthorityEndpoint
  expectedOwner: SshTerminalAuthorityEndpointIdentity
}): string {
  const script = relayScript(args.host, args.ownerRelayDir)
  if (!isWindowsRemoteHost(args.host)) {
    return (
      `cd ${shellEscape(args.ownerRelayDir)} && ` +
      `${shellEscape(args.nodePath)} ${shellEscape(script)} --connect ` +
      `--sock-path ${shellEscape(args.endpoint.socketPath)} ` +
      `--credential-file ${shellEscape(args.endpoint.credentialFile)} ` +
      `--authority-expect-host-id ${shellEscape(args.expectedOwner.authorityHostId)} ` +
      `--authority-expect-owner-instance ${shellEscape(args.expectedOwner.ownerInstanceId)} ` +
      `--authority-expect-revision ${String(args.expectedOwner.revision)}`
    )
  }
  return commandWithNodePath(
    args.host,
    args.nodePath,
    args.ownerRelayDir,
    [
      `& ${powerShellLiteral(args.nodePath)}`,
      powerShellNativeArg(script),
      '--connect',
      '--sock-path',
      powerShellNativeArg(args.endpoint.socketPath),
      '--credential-file',
      powerShellNativeArg(args.endpoint.credentialFile),
      '--authority-expect-host-id',
      powerShellNativeArg(args.expectedOwner.authorityHostId),
      '--authority-expect-owner-instance',
      powerShellNativeArg(args.expectedOwner.ownerInstanceId),
      '--authority-expect-revision',
      String(args.expectedOwner.revision)
    ].join(' ')
  )
}

function authorityArguments(args: {
  host: RemoteHostPlatform
  endpoint: SshTerminalAuthorityEndpoint
  processToken: string
  graceTimeSeconds: number
  takeover?: SshTerminalAuthorityTakeover
}): string[] {
  const endpointDir = relayHookEndpointDirForHost(
    args.host,
    args.endpoint.stateDir,
    args.endpoint.socketPath
  )
  return [
    '--detached',
    '--terminal-authority',
    '--grace-time',
    String(args.graceTimeSeconds),
    '--sock-path',
    args.endpoint.socketPath,
    '--credential-file',
    args.endpoint.credentialFile,
    '--endpoint-dir',
    endpointDir,
    '--log-file',
    args.endpoint.logFile,
    '--authority-state-dir',
    args.endpoint.stateDir,
    '--authority-marker-path',
    args.endpoint.activeEndpointMarker,
    '--authority-process-token',
    args.processToken,
    ...(args.takeover
      ? [
          '--authority-takeover-token',
          args.takeover.ownerProcessToken,
          '--authority-takeover-revision',
          String(args.takeover.revision)
        ]
      : [])
  ]
}

export function sshTerminalAuthorityLaunchCommand(args: {
  host: RemoteHostPlatform
  nodePath: string
  relayDir: string
  endpoint: SshTerminalAuthorityEndpoint
  processToken: string
  graceTimeSeconds: number
  takeover?: SshTerminalAuthorityTakeover
}): string {
  const script = relayScript(args.host, args.relayDir)
  const launchArgs = authorityArguments(args)
  if (!isWindowsRemoteHost(args.host)) {
    const command = [shellEscape(args.nodePath), shellEscape(script)]
      .concat(launchArgs.map(shellEscape))
      .join(' ')
    return (
      `cd ${shellEscape(args.relayDir)} && chmod 600 ${shellEscape(args.endpoint.credentialFile)} && ` +
      `nohup ${command} > ${shellEscape(args.endpoint.logFile)} 2>&1 </dev/null &`
    )
  }
  const quoted = (value: string): string => `"${value.replace(/"/g, '\\"')}"`
  const commandLine = [quoted(args.nodePath), quoted(script)]
    .concat(launchArgs.map(quoted))
    .concat([`1>${quoted(args.endpoint.logFile)}`, `2>${quoted(args.endpoint.errorLogFile)}`])
    .join(' ')
  const wmiCommandLine = `cmd.exe /d /s /c "${commandLine}"`
  return commandWithNodePath(
    args.host,
    args.nodePath,
    args.relayDir,
    [
      `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${powerShellLiteral(wmiCommandLine)}; CurrentDirectory = ${powerShellLiteral(args.relayDir)} }`,
      'if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create failed with $($result.ReturnValue)" }'
    ].join('; ')
  )
}

export function sshTerminalAuthorityReadyCommand(args: {
  host: RemoteHostPlatform
  nodePath: string
  relayDir: string
  socketPath: string
}): string {
  const js = [
    'const net=require("net");',
    'const endpoint=process.argv[1];',
    'const deadline=Date.now()+Number(process.argv[2]);',
    'const interval=Number(process.argv[3]);',
    'function finish(value){process.stdout.write(value);process.exit(0)}',
    'function attempt(){const socket=net.connect(endpoint);let settled=false;',
    'function retry(){if(settled)return;settled=true;socket.destroy();',
    'if(Date.now()>=deadline)finish("WAITING");else setTimeout(attempt,interval)}',
    'socket.setTimeout(Math.min(interval,500));',
    'socket.on("connect",()=>{if(settled)return;settled=true;socket.destroy();finish("READY")});',
    'socket.on("timeout",retry);socket.on("error",retry)}attempt();'
  ].join('')
  if (!isWindowsRemoteHost(args.host)) {
    return [
      shellEscape(args.nodePath),
      '-e',
      shellEscape(js),
      shellEscape(args.socketPath),
      String(AUTHORITY_READY_TIMEOUT_MS),
      String(AUTHORITY_READY_INTERVAL_MS)
    ].join(' ')
  }
  return commandWithNodePath(
    args.host,
    args.nodePath,
    args.relayDir,
    [
      `& ${powerShellLiteral(args.nodePath)}`,
      '-e',
      powerShellNativeArg(js),
      powerShellNativeArg(args.socketPath),
      powerShellNativeArg(String(AUTHORITY_READY_TIMEOUT_MS)),
      powerShellNativeArg(String(AUTHORITY_READY_INTERVAL_MS))
    ].join(' ')
  )
}
