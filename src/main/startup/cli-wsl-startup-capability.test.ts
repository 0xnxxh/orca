import { beforeEach, describe, expect, it, vi } from 'vitest'

const cliMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  install: vi.fn(),
  reconcile: vi.fn(),
  installDispatcher: vi.fn()
}))

vi.mock('../cli/cli-installer', () => ({
  CliInstaller: class {
    constructor(options: unknown) {
      cliMocks.constructor(this, options)
    }

    install() {
      return cliMocks.install(this)
    }
  }
}))

vi.mock('../cli/linux-bare-orca-dispatcher', () => ({
  installLinuxBareOrcaDispatcher: cliMocks.installDispatcher
}))

vi.mock('../cli/wsl-cli-registration-reconciliation', () => ({
  reconcileManagedWslCliRegistrations: cliMocks.reconcile
}))

import { createCliWslStartupCapability } from './cli-wsl-startup-capability'

describe('CLI and WSL startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns one aggregate capability with the original reconciliation identity', () => {
    const capability = createCliWslStartupCapability()
    const options = {
      isPackaged: true,
      userDataPath: 'profile-data',
      appVersion: '1.2.3'
    }

    capability.reconcileManagedWslCliRegistrations(options)

    expect(capability.reconcileManagedWslCliRegistrations).toBe(cliMocks.reconcile)
    expect(cliMocks.reconcile).toHaveBeenCalledOnce()
    expect(cliMocks.reconcile).toHaveBeenCalledWith(options)
  })

  it('constructs one live installer with the original options and invokes its install', async () => {
    const capability = createCliWslStartupCapability()
    const options = { privilegedRunner: vi.fn() }
    const status = { state: 'installed' }
    cliMocks.install.mockResolvedValue(status)

    await expect(capability.installServeCli(options)).resolves.toBe(status)

    expect(cliMocks.constructor).toHaveBeenCalledOnce()
    const installer = cliMocks.constructor.mock.calls[0]?.[0]
    expect(cliMocks.constructor).toHaveBeenCalledWith(installer, options)
    expect(cliMocks.install).toHaveBeenCalledWith(installer)
  })

  it('passes dispatcher options through the original function identity', () => {
    const capability = createCliWslStartupCapability()
    const options = { resourcesPath: 'resources' }

    capability.installLinuxBareOrcaDispatcher(options)

    expect(capability.installLinuxBareOrcaDispatcher).toBe(cliMocks.installDispatcher)
    expect(cliMocks.installDispatcher).toHaveBeenCalledOnce()
    expect(cliMocks.installDispatcher).toHaveBeenCalledWith(options)
  })
})
