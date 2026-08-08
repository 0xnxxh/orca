export type LinuxUnixSocketRecord = Readonly<{
  flags: string
  type: string
  state: string
  inode: string
  path: string | null
}>

export type LsofUnixSocketRecord = Readonly<{
  pid: number
  fd: string
  type: string
  name: string
  state: string | null
}>

const PROC_NET_UNIX_RECORD = /^\S+:\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/

export function parseLinuxProcNetUnix(input: string): LinuxUnixSocketRecord[] {
  const records: LinuxUnixSocketRecord[] = []
  for (const line of input.split(/\r?\n/).slice(1)) {
    const match = PROC_NET_UNIX_RECORD.exec(line.trim())
    if (!match) {
      continue
    }
    records.push(
      Object.freeze({
        flags: match[3],
        type: match[4],
        state: match[5],
        inode: match[6],
        path: match[7]?.trim() || null
      })
    )
  }
  return records
}

export function parseLsofUnixFields(input: string): LsofUnixSocketRecord[] {
  const records: LsofUnixSocketRecord[] = []
  let pid: number | null = null
  let current: MutableLsofRecord | null = null
  const finish = (): void => {
    if (current && pid !== null && current.fd && current.type) {
      records.push(
        Object.freeze({
          pid,
          fd: current.fd,
          type: current.type,
          name: current.name,
          state: current.state
        })
      )
    }
    current = null
  }
  for (const field of input.replaceAll('\0', '\n').split(/\r?\n+/)) {
    if (!field) {
      continue
    }
    const tag = field[0]
    const value = field.slice(1)
    if (tag === 'p') {
      finish()
      const parsed = Number(value)
      pid = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
    } else if (tag === 'f') {
      finish()
      current = { fd: value, type: '', name: '', state: null }
    } else if (current && tag === 't') {
      current.type = value
    } else if (current && tag === 'n') {
      current.name = value
    } else if (current && tag === 'T' && value.startsWith('ST=')) {
      current.state = value.slice(3)
    }
  }
  finish()
  return records
}

type MutableLsofRecord = {
  fd: string
  type: string
  name: string
  state: string | null
}

export function lsofNameReferencesSocket(name: string, socketPath: string): boolean {
  if (name === socketPath) {
    return true
  }
  return name
    .split(/\s*->\s*/)
    .map((part) => part.replace(/\s+type=\w+.*$/i, '').trim())
    .includes(socketPath)
}
