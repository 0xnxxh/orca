export type RendererRecoveryPromptControllerOptions = {
  showPrompt: () => Promise<{ response: number }>
  isQuitting: () => boolean
  reload: () => void
  quit: () => void
  onPromptError: (error: unknown) => void
}

export class RendererRecoveryPromptController {
  private showing = false

  async present(options: RendererRecoveryPromptControllerOptions): Promise<void> {
    if (this.showing) {
      return
    }
    this.showing = true
    let response: number
    try {
      response = (await options.showPrompt()).response
    } catch (error) {
      options.onPromptError(error)
      if (!options.isQuitting()) {
        options.quit()
      }
      return
    } finally {
      this.showing = false
    }
    if (options.isQuitting()) {
      return
    }
    if (response === 0) {
      options.reload()
    } else if (response === 1) {
      options.quit()
    }
  }
}
