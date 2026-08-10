import { describe, expect, it, vi } from 'vitest'
import { RendererRecoveryPromptController } from './renderer-recovery-prompt-controller'

function createOptions(showPrompt: () => Promise<{ response: number }>) {
  return {
    showPrompt: vi.fn(showPrompt),
    isQuitting: vi.fn(() => false),
    reload: vi.fn(),
    quit: vi.fn(),
    onPromptError: vi.fn()
  }
}

describe('RendererRecoveryPromptController', () => {
  it('routes the dialog choices', async () => {
    const controller = new RendererRecoveryPromptController()
    const reload = createOptions(async () => ({ response: 0 }))
    const quit = createOptions(async () => ({ response: 1 }))

    await controller.present(reload)
    await controller.present(quit)

    expect(reload.reload).toHaveBeenCalledOnce()
    expect(reload.quit).not.toHaveBeenCalled()
    expect(quit.quit).toHaveBeenCalledOnce()
    expect(quit.reload).not.toHaveBeenCalled()
  })

  it('allows only one concurrent prompt', async () => {
    const controller = new RendererRecoveryPromptController()
    let resolveFirst: ((value: { response: number }) => void) | undefined
    const first = createOptions(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    const second = createOptions(async () => ({ response: 0 }))

    const pending = controller.present(first)
    await controller.present(second)

    expect(second.showPrompt).not.toHaveBeenCalled()
    resolveFirst?.({ response: 0 })
    await pending
  })

  it('quits cleanly when the native prompt fails', async () => {
    const controller = new RendererRecoveryPromptController()
    const error = new Error('dialog failed')
    const options = createOptions(async () => {
      throw error
    })

    await controller.present(options)

    expect(options.onPromptError).toHaveBeenCalledWith(error)
    expect(options.quit).toHaveBeenCalledOnce()
    expect(options.reload).not.toHaveBeenCalled()
  })

  it('does nothing when teardown starts while the prompt is open', async () => {
    const controller = new RendererRecoveryPromptController()
    let resolvePrompt: ((value: { response: number }) => void) | undefined
    const options = createOptions(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve
        })
    )

    const pending = controller.present(options)
    options.isQuitting.mockReturnValue(true)
    resolvePrompt?.({ response: 0 })
    await pending

    expect(options.reload).not.toHaveBeenCalled()
    expect(options.quit).not.toHaveBeenCalled()
  })
})
