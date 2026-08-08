import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/app' }
}))

import { SshConnection } from './ssh-connection'
import { deployAndLaunchRelay } from './ssh-relay-deploy'
import { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { uploadDirectoryViaSystemSsh } from './ssh-system-fallback'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from '../../shared/relay-daemon-compatibility'
import type { SshTarget } from '../../shared/ssh-types'

const RELAY_VERSION = '0.1.0+abcdef012345'

function makeTarget(): SshTarget {
  return {
    id: 'system-transport-target',
    label: 'System Transport Target',
    configHost: 'fdpass-host',
    host: 'ignored.example.com',
    port: 22,
    username: ''
  }
}

function writeFakeSsh(dir: string): string {
  const path = join(dir, 'fake-ssh')
  writeFileSync(
    path,
    `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-p|-i|-J|-S) shift 2 ;;
    -T) shift ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
if [ "$#" -gt 0 ]; then
  shift
fi
cmd="$1"
if [ -z "$cmd" ]; then
  exit 0
fi
exec /bin/sh -c "$cmd"
`
  )
  chmodSync(path, 0o755)
  return path
}

function writeFakeRelay(dir: string): void {
  writeFileSync(join(dir, 'relay-watcher.js'), '')
  writeFileSync(join(dir, 'managed-hook-runtime.js'), '')
  writeFileSync(
    join(dir, 'relay.js'),
    `
const fs = require('fs');
const net = require('net');
const sentinel = 'ORCA-RELAY v0.1.0 READY\\n';
const sockPath = process.argv[process.argv.indexOf('--sock-path') + 1];
const authorityMarkerPath = process.argv[process.argv.indexOf('--authority-marker-path') + 1];
const credentialFile = process.argv[process.argv.indexOf('--credential-file') + 1];
const authorityProcessToken = process.argv[process.argv.indexOf('--authority-process-token') + 1];
const relayVersion = '${RELAY_VERSION}';
const compatibility = ${JSON.stringify(CURRENT_RELAY_DAEMON_COMPATIBILITY)};

function encode(msg) {
  const payload = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(13);
  header[0] = 1;
  header.writeUInt32BE(1, 1);
  header.writeUInt32BE(0, 5);
  header.writeUInt32BE(payload.length, 9);
  return Buffer.concat([header, payload]);
}

function serve(socket, onResolved) {
  socket.on('error', () => {});
  socket.write(sentinel);
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 13) {
      const type = buffer[0];
      const length = buffer.readUInt32BE(9);
      if (buffer.length < 13 + length) return;
      const payload = buffer.subarray(13, 13 + length);
      buffer = buffer.subarray(13 + length);
      if (type !== 1) continue;
      const message = JSON.parse(payload.toString('utf8'));
      if (message.method === 'session.resolveHome') {
        socket.write(
          encode({ jsonrpc: '2.0', id: message.id, result: process.env.HOME }),
          () => {
            onResolved();
            socket.end();
          }
        );
      }
    }
  });
}

if (process.argv.includes('--terminal-authority')) {
  const child = require('child_process').spawn(
    process.execPath,
    [
      __filename,
      '--authority-server',
      '--sock-path',
      sockPath,
      '--authority-marker-path',
      authorityMarkerPath,
      '--credential-file',
      credentialFile,
      '--authority-process-token',
      authorityProcessToken
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  process.exit(0);
} else if (process.argv.includes('--authority-server')) {
  fs.mkdirSync(require('path').dirname(authorityMarkerPath), { recursive: true });
  fs.writeFileSync(authorityMarkerPath, JSON.stringify({
    markerVersion: 1,
    authorityHostId: 'authority-host',
    ownerInstanceId: 'authority-owner',
    ownerPid: process.pid,
    ownerProcessToken: authorityProcessToken,
    ownerBuildId: relayVersion,
    ownerRelayDir: require('path').join(process.env.HOME, '.orca-remote', 'relay-' + relayVersion),
    socketPath: sockPath,
    credentialFile,
    compatibility,
    revision: 1
  }) + '\\n');
  try { fs.unlinkSync(sockPath); } catch {}
  const server = net.createServer((socket) => serve(socket, () => server.close()));
  process.once('SIGTERM', () => {
    try { server.close(); } catch {}
    try { fs.unlinkSync(authorityMarkerPath); } catch {}
    try { fs.unlinkSync(sockPath); } catch {}
    process.exit(0);
  });
  server.listen(sockPath);
} else if (process.argv.includes('--detached')) {
  const child = require('child_process').spawn(
    process.execPath,
    [__filename, '--relay-server', '--sock-path', sockPath],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  process.exit(0);
} else if (process.argv.includes('--relay-server')) {
  try { fs.unlinkSync(sockPath); } catch {}
  const server = net.createServer((socket) => {
    serve(socket, () => server.close());
  });
  server.listen(sockPath);
} else if (process.argv.includes('--connect')) {
  const socket = net.createConnection(sockPath);
  socket.on('error', (error) => {
    process.stderr.write(error.message);
    process.exit(1);
  });
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
}
`
  )
}

function createRelayTree(root: string, remoteHome: string): void {
  const platforms = [
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
    'win32-arm64'
  ]
  for (const platform of platforms) {
    const localDir = join(root, platform)
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, '.version'), RELAY_VERSION)
    writeFakeRelay(localDir)
  }

  const remoteDir = join(remoteHome, '.orca-remote', `relay-${RELAY_VERSION}`)
  mkdirSync(join(remoteDir, 'node_modules', 'node-pty', 'lib'), { recursive: true })
  mkdirSync(join(remoteDir, 'node_modules', '@parcel', 'watcher'), { recursive: true })
  writeFileSync(join(remoteDir, 'node_modules', 'node-pty', 'index.js'), '')
  writeFileSync(
    join(remoteDir, 'node_modules', 'node-pty', 'lib', 'utils.js'),
    'exports.loadNativeModule = () => ({})\n'
  )
  writeFileSync(join(remoteDir, 'node_modules', '@parcel', 'watcher', 'index.js'), '')
  writeFileSync(join(remoteDir, '.install-complete'), '')
  writeFakeRelay(remoteDir)
}

async function stopFakeAuthority(tempDir: string): Promise<void> {
  const markerPath = join(
    tempDir,
    'remote-home',
    '.orca-remote',
    'terminal-authority',
    'active-endpoint'
  )
  let ownerPid: unknown
  try {
    ownerPid = JSON.parse(readFileSync(markerPath, 'utf8')).ownerPid
  } catch {
    return
  }
  if (typeof ownerPid !== 'number' || !Number.isInteger(ownerPid) || ownerPid <= 0) {
    return
  }
  try {
    process.kill(ownerPid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(ownerPid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  try {
    process.kill(ownerPid, 'SIGKILL')
  } catch {
    // The authority exited between the final probe and fallback kill.
  }
}

describe('system SSH transport integration', () => {
  let tempDir: string
  let oldHome: string | undefined
  let oldRelayPath: string | undefined
  let oldSystemSshPath: string | undefined
  let oldForceSystemTransport: string | undefined

  beforeEach(() => {
    if (process.platform === 'win32') {
      return
    }
    tempDir = mkdtempSync(join('/tmp', 'orca-ssh-'))
    oldHome = process.env.HOME
    oldRelayPath = process.env.ORCA_RELAY_PATH
    oldSystemSshPath = process.env.ORCA_SYSTEM_SSH_PATH
    oldForceSystemTransport = process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT
    const remoteHome = join(tempDir, 'remote-home')
    const relayRoot = join(tempDir, 'relay')
    mkdirSync(remoteHome, { recursive: true })
    createRelayTree(relayRoot, remoteHome)
    process.env.HOME = remoteHome
    process.env.ORCA_RELAY_PATH = relayRoot
    process.env.ORCA_SYSTEM_SSH_PATH = writeFakeSsh(tempDir)
    process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT = '1'
  })

  afterEach(async () => {
    if (process.platform === 'win32') {
      return
    }
    await stopFakeAuthority(tempDir)
    if (oldHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = oldHome
    }
    if (oldRelayPath === undefined) {
      delete process.env.ORCA_RELAY_PATH
    } else {
      process.env.ORCA_RELAY_PATH = oldRelayPath
    }
    if (oldSystemSshPath === undefined) {
      delete process.env.ORCA_SYSTEM_SSH_PATH
    } else {
      process.env.ORCA_SYSTEM_SSH_PATH = oldSystemSshPath
    }
    if (oldForceSystemTransport === undefined) {
      delete process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT
    } else {
      process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT = oldForceSystemTransport
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Why: this fixture writes a POSIX fake ssh script to exercise stdin/stdout
  // transport semantics; Windows coverage stays in argument/unit tests.
  it.skipIf(process.platform === 'win32')(
    'deploys and speaks relay RPC over a system ssh process for ProxyUseFdpass targets',
    async () => {
      const conn = new SshConnection(makeTarget(), { onStateChange: vi.fn() })
      const onProgress = vi.fn()
      await conn.connect()
      expect(conn.usesSystemSshTransport()).toBe(true)

      const result = await deployAndLaunchRelay(conn, onProgress, 60, makeTarget().id)
      expect(onProgress).toHaveBeenCalledWith('Starting relay...')
      expect(onProgress).not.toHaveBeenCalledWith('Uploading relay...')
      expect(onProgress).not.toHaveBeenCalledWith('Installing native dependencies...')
      const mux = new SshChannelMultiplexer(result.transport)
      try {
        await expect(mux.request('session.resolveHome', { path: '~' })).resolves.toBe(
          join(tempDir, 'remote-home')
        )
      } finally {
        mux.dispose()
        await conn.disconnect()
      }
    },
    20_000
  )

  it.skipIf(process.platform === 'win32')(
    'connects GSSAPI-flagged targets through system ssh without the force override',
    async () => {
      delete process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT
      const conn = new SshConnection(
        { ...makeTarget(), source: 'manual', gssapiAuthentication: true },
        { onStateChange: vi.fn() }
      )
      await conn.connect()
      try {
        expect(conn.usesSystemSshTransport()).toBe(true)
        expect(conn.getState().status).toBe('connected')
      } finally {
        await conn.disconnect()
      }
    },
    20_000
  )

  it.skipIf(process.platform === 'win32')(
    'uploads a directory through the system ssh stdin/stdout path',
    async () => {
      const source = join(tempDir, 'source')
      const destination = join(tempDir, 'uploaded')
      mkdirSync(source, { recursive: true })
      writeFileSync(join(source, 'payload.txt'), 'uploaded over system ssh')

      await uploadDirectoryViaSystemSsh(makeTarget(), source, destination)

      expect(readFileSync(join(destination, 'payload.txt'), 'utf8')).toBe(
        'uploaded over system ssh'
      )
    }
  )
})
