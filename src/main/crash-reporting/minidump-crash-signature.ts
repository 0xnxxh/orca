// Extracts the diagnosable parts of a Crashpad minidump without symbols.
//
// Why: a Chromium CHECK/DCHECK surfaces to `render-process-gone` as exit code
// 0x80000003 (STATUS_BREAKPOINT) and nothing else, so the exit code alone can
// never name the failing check. Crashpad stores the fatal log line verbatim in
// the `LOG_FATAL` annotation, so the check name, file and line are recoverable
// from the dump itself — no symbol server, no minidump_stackwalk.
//
// Layouts are from Crashpad's minidump_extensions.h and the Windows
// MINIDUMP_* structs. Everything here is bounds-checked and returns null
// rather than throwing: a truncated dump must degrade, not break crash
// reporting.

import { findStream, isMinidump, MAX_MODULES, MinidumpView } from './minidump-stream-reader'
import { readCrashpadAnnotations } from './minidump-crashpad-annotations'

const STREAM_TYPE_MODULE_LIST = 4
const STREAM_TYPE_EXCEPTION = 6

const MODULE_RECORD_SIZE = 108
const MODULE_BASE_OFFSET = 0
const MODULE_SIZE_OFFSET = 8
const MODULE_NAME_RVA_OFFSET = 20

// MINIDUMP_EXCEPTION_STREAM: ThreadId u32, __alignment u32, then MINIDUMP_EXCEPTION.
const EXCEPTION_RECORD_OFFSET = 8
const EXCEPTION_CODE_OFFSET = EXCEPTION_RECORD_OFFSET + 0
const EXCEPTION_ADDRESS_OFFSET = EXCEPTION_RECORD_OFFSET + 16

export type MinidumpCrashSignature = {
  /** Chromium's fatal log line, e.g. `[...:FATAL:node.cc(123)] Check failed: !x.` */
  readonly checkMessage?: string
  /** Source file basename parsed out of `checkMessage`. */
  readonly checkFile?: string
  readonly checkLine?: number
  /** Crashpad `ptype`: `renderer`, `gpu-process`, `browser`. */
  readonly processType?: string
  /** Win32 exception code / POSIX signal, e.g. 0x80000003 STATUS_BREAKPOINT. */
  readonly exceptionCode?: number
  readonly exceptionAddress?: string
  /** Module whose image range contains `exceptionAddress`. */
  readonly faultingModule?: string
  readonly faultingModuleOffset?: string
  /** Allowlisted Crashpad annotations, verbatim. */
  readonly annotations: Readonly<Record<string, string>>
}

type ModuleRecord = {
  readonly base: bigint
  readonly size: number
  readonly name: string
}

function readModules(view: MinidumpView): ModuleRecord[] {
  const stream = findStream(view, STREAM_TYPE_MODULE_LIST)
  if (!stream) {
    return []
  }
  const count = view.u32(stream.rva)
  if (count === null || count > MAX_MODULES) {
    return []
  }
  const modules: ModuleRecord[] = []
  for (let index = 0; index < count; index += 1) {
    const record = stream.rva + 4 + index * MODULE_RECORD_SIZE
    const base = view.u64(record + MODULE_BASE_OFFSET)
    const size = view.u32(record + MODULE_SIZE_OFFSET)
    const nameRva = view.u32(record + MODULE_NAME_RVA_OFFSET)
    if (base === null || size === null || nameRva === null) {
      break
    }
    const name = view.utf16String(nameRva, 2_048)
    modules.push({ base, size, name: name ?? 'unknown' })
  }
  return modules
}

function moduleBasename(modulePath: string): string {
  const separator = Math.max(modulePath.lastIndexOf('/'), modulePath.lastIndexOf('\\'))
  return separator >= 0 ? modulePath.slice(separator + 1) : modulePath
}

function toHex(value: bigint): string {
  return `0x${value.toString(16)}`
}

/**
 * Chromium logs `[pid:tid:MMDD/HHMMSS.uuuuuu:FATAL:file.cc(123)] message`.
 * `LogMessage::Init` strips the directory, so only a basename appears here —
 * which is why the fatal line survives crash-report path redaction intact.
 */
function parseCheckLocation(checkMessage: string): {
  file?: string
  line?: number
} {
  const match = /:(?:FATAL|CHECK|DFATAL)(?::[^:\]]*)?:([^:()\s]+)\((\d+)\)/.exec(checkMessage)
  if (!match) {
    return {}
  }
  const line = Number.parseInt(match[2], 10)
  return { file: match[1], line: Number.isFinite(line) ? line : undefined }
}

function findFaultingModule(
  modules: ModuleRecord[],
  address: bigint
): { name: string; offset: string } | undefined {
  for (const module of modules) {
    if (address >= module.base && address < module.base + BigInt(module.size)) {
      return {
        name: moduleBasename(module.name),
        offset: toHex(address - module.base)
      }
    }
  }
  return undefined
}

/**
 * Parses a Crashpad minidump into the fields that make a CHECK failure
 * nameable. Returns null when the buffer is not a minidump.
 */
export function parseMinidumpCrashSignature(dump: Buffer): MinidumpCrashSignature | null {
  if (!isMinidump(dump)) {
    return null
  }
  const view = new MinidumpView(dump)
  const annotations = readCrashpadAnnotations(view)

  const signature: {
    -readonly [K in keyof MinidumpCrashSignature]: MinidumpCrashSignature[K]
  } = { annotations }

  const checkMessage = annotations['LOG_FATAL'] ?? annotations['abort-message']
  if (checkMessage) {
    signature.checkMessage = checkMessage
    const { file, line } = parseCheckLocation(checkMessage)
    signature.checkFile = file
    signature.checkLine = line
  }
  if (annotations['ptype']) {
    signature.processType = annotations['ptype']
  }

  const exception = findStream(view, STREAM_TYPE_EXCEPTION)
  if (exception) {
    const code = view.u32(exception.rva + EXCEPTION_CODE_OFFSET)
    const address = view.u64(exception.rva + EXCEPTION_ADDRESS_OFFSET)
    if (code !== null) {
      signature.exceptionCode = code
    }
    if (address !== null) {
      signature.exceptionAddress = toHex(address)
      const faulting = findFaultingModule(readModules(view), address)
      if (faulting) {
        signature.faultingModule = faulting.name
        signature.faultingModuleOffset = faulting.offset
      }
    }
  }

  return signature
}

/** Flattens a signature into `CrashReportRecord.details` keys. */
export function minidumpSignatureDetails(
  signature: MinidumpCrashSignature
): Record<string, string | number> {
  const details: Record<string, string | number> = {}
  if (signature.checkMessage) {
    details.minidumpCheckMessage = signature.checkMessage
  }
  if (signature.checkFile) {
    details.minidumpCheckFile = signature.checkFile
  }
  if (signature.checkLine !== undefined) {
    details.minidumpCheckLine = signature.checkLine
  }
  if (signature.processType) {
    details.minidumpProcessType = signature.processType
  }
  if (signature.exceptionCode !== undefined) {
    details.minidumpExceptionCode = `0x${(signature.exceptionCode >>> 0).toString(16)}`
  }
  if (signature.exceptionAddress) {
    details.minidumpExceptionAddress = signature.exceptionAddress
  }
  if (signature.faultingModule) {
    details.minidumpFaultingModule = signature.faultingModule
  }
  if (signature.faultingModuleOffset) {
    details.minidumpFaultingModuleOffset = signature.faultingModuleOffset
  }
  for (const [key, value] of Object.entries(signature.annotations)) {
    if (key === 'LOG_FATAL' || key === 'abort-message' || key === 'ptype') {
      continue
    }
    details[`minidumpAnnotation_${key.replace(/-/g, '_')}`] = value
  }
  return details
}
