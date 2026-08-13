#!/usr/bin/env node

const READY_MARKER = 'GOLDEN_STUB_AGENT_READY'
const EXIT_MARKER = 'GOLDEN_STUB_AGENT_EXITED'

let composer = ''
let lastSubmission = ''
let pendingInput = ''
let exiting = false

function render() {
  const lines = composer.split('\n')
  const renderedComposer = lines.map((line, index) => `${index === 0 ? '> ' : '  '}${line}`)
  process.stdout.write(
    `\x1b]0;Golden Stub Agent\x07${[
      '\x1b[H\x1b[2JGolden Stub Agent',
      `[${READY_MARKER}]`,
      '',
      ...renderedComposer,
      '',
      'Shift+Enter inserts a newline. Type exit then Enter to quit.',
      ...(lastSubmission ? [`[GOLDEN_STUB_AGENT_SUBMITTED] ${lastSubmission}`] : [])
    ].join('\r\n')}`
  )
}

function exitCleanly() {
  if (exiting) {
    return
  }
  exiting = true
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
  }
  process.stdout.write(`\x1b[?1049l[${EXIT_MARKER}]\r\n`, () => process.exit(0))
}

function submit() {
  if (composer.trim() === 'exit') {
    exitCleanly()
    return
  }
  lastSubmission = composer
  composer = ''
  render()
}

function consumeInput() {
  while (pendingInput.length > 0 && !exiting) {
    const shiftEnter = ['\x1b[13;2u', '\x1b[13;2~', '\x1b\r'].find((sequence) =>
      pendingInput.startsWith(sequence)
    )
    if (shiftEnter) {
      pendingInput = pendingInput.slice(shiftEnter.length)
      composer += '\n'
      render()
      continue
    }
    if (
      pendingInput === '\x1b' ||
      ('\x1b[13;2u'.startsWith(pendingInput) && pendingInput.startsWith('\x1b[')) ||
      ('\x1b[13;2~'.startsWith(pendingInput) && pendingInput.startsWith('\x1b['))
    ) {
      return
    }

    const char = pendingInput[0]
    pendingInput = pendingInput.slice(1)
    if (char === '\r' || char === '\n') {
      submit()
    } else if (char === '\x04') {
      exitCleanly()
    } else if (char === '\x7f' || char === '\b') {
      composer = composer.slice(0, -1)
      render()
    } else if (char >= ' ') {
      composer += char
      render()
    }
  }
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  pendingInput += chunk
  consumeInput()
})
process.stdin.resume()

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, exitCleanly)
}

process.stdout.write('\x1b[?1049h')
render()
