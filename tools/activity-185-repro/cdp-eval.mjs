// TEMPORARY CDP driver for the Activity #185 repro. Connects to the running
// dev Orca renderer over the Chrome DevTools Protocol and evaluates an
// expression passed via argv[2] (or stdin). Prints the JSON value or the
// exception. Not shipped — lives under tools/ for the repro only.
import WebSocket from 'ws'

const PORT = process.env.ORCA_CDP_PORT || '9333'
const expr = process.argv[2] ?? (await readStdin())

async function readStdin() {
  let d = ''
  for await (const c of process.stdin) d += c
  return d
}

async function pickPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await res.json()
  const page =
    targets.find((t) => t.type === 'page' && /localhost:5173/.test(t.url)) ??
    targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target found')
  return page.webSocketDebuggerUrl
}

const wsUrl = await pickPageTarget()
const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
function send(method, params) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}
ws.on('message', (buf) => {
  const msg = JSON.parse(buf.toString())
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
})
ws.on('open', async () => {
  try {
    await send('Runtime.enable', {})
    const result = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      allowUnsafeEvalBlocklisting: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      console.log(
        'EXCEPTION:',
        JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)
      )
    } else {
      const v = result.result.value
      console.log(typeof v === 'string' ? v : JSON.stringify(v))
    }
  } catch (e) {
    console.log('ERROR:', e.message)
  } finally {
    ws.close()
  }
})
ws.on('error', (e) => {
  console.log('WS ERROR:', e.message)
  process.exit(1)
})
