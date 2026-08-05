export function isDenseTerminalSgr(data: string): boolean {
  let sgrSequences = 0
  let textChars = 0

  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== '\x1b' || data[index + 1] !== '[') {
      textChars += 1
      continue
    }

    let cursor = index + 2
    while (cursor < data.length) {
      const code = data.charCodeAt(cursor)
      if (code >= 0x40 && code <= 0x7e) {
        if (data[cursor] === 'm') {
          sgrSequences += 1
        }
        index = cursor
        break
      }
      cursor += 1
    }
  }

  return sgrSequences >= 32 && sgrSequences * 2 >= textChars
}

export function stripTerminalSgr(data: string): string {
  let output = ''
  let copyFrom = 0

  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== '\x1b' || data[index + 1] !== '[') {
      continue
    }
    let cursor = index + 2
    while (cursor < data.length) {
      const code = data.charCodeAt(cursor)
      if (code >= 0x40 && code <= 0x7e) {
        if (data[cursor] === 'm') {
          output += data.slice(copyFrom, index)
          copyFrom = cursor + 1
        }
        index = cursor
        break
      }
      cursor += 1
    }
  }

  // Boundary CAN/reset prevents carried parser or style state from swallowing retained bytes.
  return `\x18\x1b[0m${output}${data.slice(copyFrom)}\x18\x1b[0m`
}
