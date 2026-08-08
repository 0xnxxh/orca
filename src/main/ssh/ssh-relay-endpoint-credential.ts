import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { execCommand } from './ssh-relay-deploy-helpers'
import { isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellCommand, powerShellLiteral } from './ssh-remote-powershell'

const POSIX_CREDENTIAL_SCRIPT =
  'const fs=require("fs"),crypto=require("crypto"),p=process.argv[1],' +
  't=p+"."+process.pid+"."+crypto.randomBytes(8).toString("hex")+".tmp";' +
  'try{' +
  'fs.writeFileSync(t,crypto.randomBytes(32).toString("base64url"),{flag:"wx",mode:0o600});' +
  'fs.renameSync(t,p)' +
  '}finally{try{fs.unlinkSync(t)}catch(e){if(e.code!=="ENOENT")throw e}}'

const POSIX_ENSURE_CREDENTIAL_SCRIPT =
  'const fs=require("fs"),path=require("path"),crypto=require("crypto"),p=process.argv[1],' +
  't=p+"."+process.pid+"."+crypto.randomBytes(8).toString("hex")+".tmp",' +
  'valid=v=>/^[A-Za-z0-9_-]{32,256}$/.test(v);' +
  'try{' +
  'const fd=fs.openSync(t,"wx",0o600);' +
  'try{fs.writeSync(fd,crypto.randomBytes(32).toString("base64url"));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}' +
  'let published=false;try{fs.linkSync(t,p);published=true}catch(e){if(e.code!=="EEXIST")throw e}' +
  'if(published){let d;try{d=fs.openSync(path.dirname(p),"r");fs.fsyncSync(d)}finally{if(d!==undefined)fs.closeSync(d)}}' +
  'const value=fs.readFileSync(p,"utf8").trim();if(!valid(value))throw new Error("Invalid existing relay credential");' +
  'fs.chmodSync(p,0o600)' +
  '}finally{try{fs.unlinkSync(t)}catch(e){if(e.code!=="ENOENT")throw e}}'

export function relayEndpointCredentialWriteCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  credentialFile: string
): string {
  if (!isWindowsRemoteHost(hostPlatform)) {
    return `${shellEscape(nodePath)} -e ${shellEscape(POSIX_CREDENTIAL_SCRIPT)} ${shellEscape(credentialFile)}`
  }
  return powerShellCommand(
    [
      '$ErrorActionPreference = "Stop"',
      `$path = ${powerShellLiteral(credentialFile)}`,
      '$tempPath = $path + "." + [Guid]::NewGuid().ToString("N") + ".tmp"',
      '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$security = [System.Security.AccessControl.FileSecurity]::new()',
      '$security.SetOwner($identity)',
      '$security.SetAccessRuleProtection($true,$false)',
      '$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity,[System.Security.AccessControl.FileSystemRights]::FullControl,[System.Security.AccessControl.AccessControlType]::Allow)',
      '$security.AddAccessRule($rule)',
      '$random = [byte[]]::new(32)',
      '$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()',
      'try { $rng.GetBytes($random) } finally { $rng.Dispose() }',
      '$credential = [Convert]::ToBase64String($random).TrimEnd("=").Replace("+","-").Replace("/","_")',
      '$data = [System.Text.UTF8Encoding]::new($false).GetBytes($credential)',
      '$stream = [System.IO.FileStream]::new($tempPath,[System.IO.FileMode]::CreateNew,[System.Security.AccessControl.FileSystemRights]::Write,[System.IO.FileShare]::None,4096,[System.IO.FileOptions]::WriteThrough,$security)',
      'try { $stream.Write($data,0,$data.Length) } finally { $stream.Dispose() }',
      'try { [System.IO.File]::Delete($path); [System.IO.File]::Move($tempPath,$path) } finally { [System.IO.File]::Delete($tempPath) }'
    ].join('; ')
  )
}

export function relayEndpointCredentialEnsureCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  credentialFile: string
): string {
  if (!isWindowsRemoteHost(hostPlatform)) {
    return `${shellEscape(nodePath)} -e ${shellEscape(POSIX_ENSURE_CREDENTIAL_SCRIPT)} ${shellEscape(credentialFile)}`
  }
  return powerShellCommand(
    [
      '$ErrorActionPreference = "Stop"',
      `$path = ${powerShellLiteral(credentialFile)}`,
      '$valid = { param($value) $value -cmatch "^[A-Za-z0-9_-]{32,256}$" }',
      '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$security = [System.Security.AccessControl.FileSecurity]::new()',
      '$security.SetOwner($identity)',
      '$security.SetAccessRuleProtection($true,$false)',
      '$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity,[System.Security.AccessControl.FileSystemRights]::FullControl,[System.Security.AccessControl.AccessControlType]::Allow)',
      '$security.AddAccessRule($rule)',
      'if (Test-Path -LiteralPath $path -PathType Leaf) {',
      '$existing = (Get-Content -LiteralPath $path -Raw -ErrorAction Stop).Trim()',
      'if (-not (& $valid $existing)) { throw "Invalid existing relay credential" }',
      '} else {',
      '$tempPath = $path + "." + [Guid]::NewGuid().ToString("N") + ".tmp"',
      '$random = [byte[]]::new(32)',
      '$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()',
      'try { $rng.GetBytes($random) } finally { $rng.Dispose() }',
      '$credential = [Convert]::ToBase64String($random).TrimEnd("=").Replace("+","-").Replace("/","_")',
      '$data = [System.Text.UTF8Encoding]::new($false).GetBytes($credential)',
      '$stream = [System.IO.FileStream]::new($tempPath,[System.IO.FileMode]::CreateNew,[System.Security.AccessControl.FileSystemRights]::Write,[System.IO.FileShare]::None,4096,[System.IO.FileOptions]::WriteThrough,$security)',
      'try { $stream.Write($data,0,$data.Length) } finally { $stream.Dispose() }',
      'try {',
      'try { [System.IO.File]::Move($tempPath,$path) } catch [System.IO.IOException] { }',
      '$existing = (Get-Content -LiteralPath $path -Raw -ErrorAction Stop).Trim()',
      'if (-not (& $valid $existing)) { throw "Invalid existing relay credential" }',
      '} finally { [System.IO.File]::Delete($tempPath) }',
      '}',
      '(Get-Item -LiteralPath $path -ErrorAction Stop).SetAccessControl($security)'
    ].join('; ')
  )
}

export async function writeRelayEndpointCredential(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  credentialFile: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  await execCommand(
    conn,
    relayEndpointCredentialWriteCommand(hostPlatform, nodePath, credentialFile),
    {
      wrapCommand: !isWindowsRemoteHost(hostPlatform),
      signal: options?.signal
    }
  )
}

export async function ensureRelayEndpointCredential(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  credentialFile: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  await execCommand(
    conn,
    relayEndpointCredentialEnsureCommand(hostPlatform, nodePath, credentialFile),
    {
      wrapCommand: !isWindowsRemoteHost(hostPlatform),
      signal: options?.signal
    }
  )
}
