import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceRegistry, loadDeviceRegistryForReset } from './device-registry'

describe('DeviceRegistry reset loading', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('propagates corrupt registry state through the reset loader', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-device-registry-'))
    directories.push(directory)
    writeFileSync(join(directory, 'orca-devices.json'), '{invalid')

    expect(() => loadDeviceRegistryForReset(directory)).toThrow('Device registry is invalid')
    expect(new DeviceRegistry(directory).listDevices()).toEqual([])
  })

  it('accepts a fully validated registry through the reset loader', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-device-registry-'))
    directories.push(directory)
    writeFileSync(
      join(directory, 'orca-devices.json'),
      JSON.stringify([
        {
          deviceId: 'device-1',
          name: 'phone',
          token: 'token-1',
          scope: 'mobile',
          pairedAt: 1,
          lastSeenAt: 0
        }
      ])
    )

    expect(loadDeviceRegistryForReset(directory).getDevice('device-1')?.token).toBe('token-1')
  })

  it('rejects missing state only through the reset loader', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-device-registry-'))
    directories.push(directory)

    expect(() => loadDeviceRegistryForReset(directory)).toThrow('Device registry is missing')
    expect(new DeviceRegistry(directory).listDevices()).toEqual([])
  })

  it.each(['symlink', 'directory'] as const)('rejects a %s reset registry path', (kind) => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-device-registry-'))
    const outside = mkdtempSync(join(tmpdir(), 'orca-device-registry-target-'))
    directories.push(directory, outside)
    const target = join(outside, 'registry.json')
    writeFileSync(target, '[]')
    if (kind === 'symlink') {
      symlinkSync(target, join(directory, 'orca-devices.json'))
    } else {
      mkdirSync(join(directory, 'orca-devices.json'))
    }

    expect(() => loadDeviceRegistryForReset(directory)).toThrow('Device registry is invalid')
  })
})
