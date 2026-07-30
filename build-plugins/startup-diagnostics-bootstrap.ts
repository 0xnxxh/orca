import type { Plugin } from 'vite'

const COMPLETION_MARKER = '__ORCA_BOOTSTRAP_MARK_EVALUATION_COMPLETE__'

export function createStartupDiagnosticsBootstrapPrefix(chunkName: string): string {
  return `
;(() => {
  const env = typeof process !== 'undefined' ? process.env : undefined
  const mode = env?.ORCA_STARTUP_DIAGNOSTICS
  if (mode !== '1' && mode !== 'trace') {
    return
  }
  const processNow = () => {
    try {
      return globalThis.performance.now()
    } catch {
      return null
    }
  }
  const enteredAt = processNow()
  const safeJson = (value) => {
    try {
      return JSON.stringify(value)
    } catch {
      return '"<unserializable>"'
    }
  }
  let closeSync
  let diagnosticFileDescriptor
  let openSync
  let writeSync
  try {
    const fs = require('node:fs')
    closeSync = fs.closeSync
    openSync = fs.openSync
    writeSync = fs.writeSync
  } catch {
    closeSync = undefined
    openSync = undefined
    writeSync = undefined
  }
  const diagnosticFile = env?.ORCA_STARTUP_DIAGNOSTICS_FILE
  if (typeof diagnosticFile === 'string' && diagnosticFile.length > 0 && typeof openSync === 'function') {
    try {
      diagnosticFileDescriptor = openSync(diagnosticFile, 'a', 0o600)
    } catch {
      diagnosticFileDescriptor = undefined
    }
  }
  const writeLine = (message) => {
    try {
      const line = message.endsWith('\\n') ? message : message + '\\n'
      if (typeof writeSync === 'function') {
        writeSync(2, line)
        if (typeof diagnosticFileDescriptor === 'number') {
          writeSync(diagnosticFileDescriptor, line)
        }
      }
    } catch {
      // Diagnostics must never affect startup.
    }
  }
  const chunkName = ${JSON.stringify(chunkName)}
  writeLine('[bootstrap] bundle-enter t=' + safeJson(enteredAt) + ' clock="process-performance-now-ms" chunk=' + safeJson(chunkName) + ' pid=' + process.pid + ' ppid=' + process.ppid + ' execPath=' + safeJson(process.execPath) + ' argv=' + safeJson(process.argv) + ' electronRunAsNode=' + safeJson(env?.ELECTRON_RUN_AS_NODE ?? null))
  globalThis.${COMPLETION_MARKER} = () => {
    writeLine('[bootstrap] bundle-evaluation-complete t=' + safeJson(processNow()) + ' clock="process-performance-now-ms" chunk=' + safeJson(chunkName))
  }
  if (!globalThis.__ORCA_BOOTSTRAP_EXIT_LOG_INSTALLED__) {
    globalThis.__ORCA_BOOTSTRAP_EXIT_LOG_INSTALLED__ = true
    process.once('exit', (code) => {
      writeLine('[bootstrap] process-exit code=' + code)
      if (typeof closeSync === 'function' && typeof diagnosticFileDescriptor === 'number') {
        try {
          closeSync(diagnosticFileDescriptor)
        } catch {
          // Diagnostics must never affect shutdown.
        }
      }
    })
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      const message = error && typeof error === 'object' && 'stack' in error ? error.stack : error
      writeLine('[bootstrap] uncaught-exception origin=' + safeJson(origin) + ' error=' + safeJson(String(message)))
    })
    process.on('unhandledRejection', (reason) => {
      const message = reason && typeof reason === 'object' && 'stack' in reason ? reason.stack : reason
      writeLine('[bootstrap] unhandled-rejection error=' + safeJson(String(message)))
    })
  }
  if (mode === 'trace' && !globalThis.__ORCA_BOOTSTRAP_REQUIRE_TRACE_INSTALLED__) {
    globalThis.__ORCA_BOOTSTRAP_REQUIRE_TRACE_INSTALLED__ = true
    try {
      const Module = require('node:module')
      const originalLoad = Module._load
      const parsedTraceLimit = Number(env?.ORCA_STARTUP_DIAGNOSTICS_TRACE_LIMIT ?? 20000)
      const traceLimit = Number.isFinite(parsedTraceLimit) && parsedTraceLimit > 0 ? parsedTraceLimit : 20000
      let traceLineCount = 0
      let traceLimitReported = false
      const writeTraceLine = (message) => {
        if (traceLineCount >= traceLimit) {
          if (!traceLimitReported) {
            traceLimitReported = true
            writeLine('[bootstrap] require-trace-limit-reached limit=' + safeJson(traceLimit))
          }
          return
        }
        traceLineCount += 1
        writeLine(message)
      }
      Module._load = function (request, parent, isMain) {
        const parentName = parent && parent.filename ? parent.filename : null
        writeTraceLine('[bootstrap] require-start request=' + safeJson(request) + ' parent=' + safeJson(parentName) + ' isMain=' + safeJson(Boolean(isMain)))
        try {
          const result = Reflect.apply(originalLoad, this, arguments)
          writeTraceLine('[bootstrap] require-ok request=' + safeJson(request))
          return result
        } catch (error) {
          const message = error && typeof error === 'object' && 'stack' in error ? error.stack : error
          writeTraceLine('[bootstrap] require-error request=' + safeJson(request) + ' error=' + safeJson(String(message)))
          throw error
        }
      }
    } catch (error) {
      writeLine('[bootstrap] require-trace-install-error error=' + safeJson(String(error)))
    }
  }
})();
`
}

export function createStartupDiagnosticsBootstrapSuffix(): string {
  return `
;(() => {
  try {
    globalThis.${COMPLETION_MARKER}?.()
  } catch {
    // Diagnostics must never affect startup.
  }
})();
`
}

export function createStartupDiagnosticsBootstrapPlugin(): Plugin {
  return {
    name: 'orca-startup-diagnostics-bootstrap',
    generateBundle(_options, bundle) {
      const mainChunk = bundle['index.js']
      if (!mainChunk || mainChunk.type !== 'chunk') {
        return
      }

      // Why: source diagnostics run after generated imports; wrap the final entry instead.
      mainChunk.code =
        createStartupDiagnosticsBootstrapPrefix(mainChunk.fileName) +
        mainChunk.code +
        createStartupDiagnosticsBootstrapSuffix()
    }
  }
}
