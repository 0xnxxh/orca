export const TERMINAL_ACCESSORY_REPEAT_DELAY_MS = 400
export const TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS = 45

type TerminalAccessoryRepeatSender<TInput> = (input: TInput) => Promise<boolean>

export function createTerminalAccessoryRepeatController<TInput>() {
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    generation += 1
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const start = (input: TInput, send: TerminalAccessoryRepeatSender<TInput>) => {
    stop()
    const activeGeneration = generation
    const pressedAt = Date.now()

    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        timer = null
        if (generation !== activeGeneration) {
          return
        }
        void send(input).then(
          (sent) => {
            if (sent && generation === activeGeneration) {
              schedule(TERMINAL_ACCESSORY_REPEAT_INTERVAL_MS)
            }
          },
          () => undefined
        )
      }, delayMs)
    }

    void send(input).then(
      (sent) => {
        if (sent && generation === activeGeneration) {
          schedule(
            Math.min(
              TERMINAL_ACCESSORY_REPEAT_DELAY_MS,
              Math.max(0, TERMINAL_ACCESSORY_REPEAT_DELAY_MS - (Date.now() - pressedAt))
            )
          )
        }
      },
      () => undefined
    )
  }

  return { start, stop }
}
