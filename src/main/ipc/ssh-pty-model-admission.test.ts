import { describe, expect, it, vi } from 'vitest'
import { SshPtyModelAdmission } from './ssh-pty-model-admission'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function accept(admission: SshPtyModelAdmission, completion: Promise<void>) {
  return admission.accept({ ptyId: 'pty-1', providerGeneration: 7 }, 'data', 4, () => ({
    sequence: 4,
    completion
  }))
}

describe('SshPtyModelAdmission', () => {
  it('cancels a never-settling running entry when its generation closes', async () => {
    const admission = new SshPtyModelAdmission()
    const receipt = accept(admission, new Promise<void>(() => {}))
    const idle = admission.whenIdle({ ptyId: 'pty-1', providerGeneration: 7 })

    admission.closeGeneration(7, 'provider-closed')

    await expect(receipt).rejects.toThrow('provider-closed')
    await expect(idle).resolves.toBeUndefined()
    expect(admission.getDebugSnapshot()).toMatchObject({ sourceUnits: 0, bytes: 0 })
  })

  it('cancels a never-settling running entry on disposal', async () => {
    const admission = new SshPtyModelAdmission()
    const receipt = accept(admission, new Promise<void>(() => {}))
    const idle = admission.whenIdle({ ptyId: 'pty-1', providerGeneration: 7 })

    admission.dispose()

    await expect(receipt).rejects.toThrow('ssh_model_admission_disposed')
    await expect(idle).resolves.toBeUndefined()
    expect(admission.getDebugSnapshot()).toMatchObject({ sourceUnits: 0, bytes: 0 })
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores a late completion %s after cancellation',
    async (settle) => {
      const completion = deferred()
      const admission = new SshPtyModelAdmission()
      const onResolve = vi.fn()
      const onReject = vi.fn()
      const receipt = accept(admission, completion.promise)
      const observed = receipt.then(onResolve, onReject)

      admission.closeGeneration(7, 'provider-closed')
      await observed
      if (settle === 'resolve') {
        completion.resolve()
      } else {
        completion.reject(new Error('late emulator failure'))
      }
      await Promise.resolve()

      expect(onResolve).not.toHaveBeenCalled()
      expect(onReject).toHaveBeenCalledTimes(1)
      expect(onReject.mock.calls[0]?.[0]).toMatchObject({ message: 'provider-closed' })
      expect(admission.getDebugSnapshot()).toMatchObject({ sourceUnits: 0, bytes: 0 })
    }
  )
})
