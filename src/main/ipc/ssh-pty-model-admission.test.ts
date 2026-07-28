import { describe, expect, it } from 'vitest'
import { SshPtyModelAdmission } from './ssh-pty-model-admission'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('SshPtyModelAdmission', () => {
  it('owns the sole running entry through disposal', async () => {
    const completion = deferred()
    const admission = new SshPtyModelAdmission()
    const receipt = admission.accept({ ptyId: 'pty-1', providerGeneration: 7 }, 'data', 4, () => ({
      sequence: 4,
      completion: completion.promise
    }))
    let idle = false
    const idleReceipt = admission.whenIdle({ ptyId: 'pty-1', providerGeneration: 7 }).then(() => {
      idle = true
    })

    admission.dispose()
    await Promise.resolve()
    expect(idle).toBe(false)
    completion.resolve()

    await expect(receipt).rejects.toThrow('ssh_model_admission_generation_closed')
    await idleReceipt
    expect(admission.getDebugSnapshot()).toMatchObject({ sourceUnits: 0, bytes: 0 })
  })
})
