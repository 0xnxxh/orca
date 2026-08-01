import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TopLevelView } from '../shared/types'
import { isTopLevelView } from '../shared/top-level-view'

const ACTIVE_VIEW_FILE_NAME = 'active-view.json'
const SAVE_DEBOUNCE_MS = 100

type ActiveViewFile = {
  activeView: TopLevelView
}

export function getActiveViewPreferenceFile(dataFile: string): string {
  return join(dirname(dataFile), ACTIVE_VIEW_FILE_NAME)
}

function readActiveView(file: string): TopLevelView | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ActiveViewFile>
    return isTopLevelView(parsed.activeView) ? parsed.activeView : null
  } catch {
    return null
  }
}

function serializeActiveView(activeView: TopLevelView): string {
  return `${JSON.stringify({ activeView } satisfies ActiveViewFile)}\n`
}

export class ActiveViewPreference {
  private readonly file: string
  private activeView: TopLevelView
  private persistedActiveView: TopLevelView | null
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private pendingWrite: Promise<void> | null = null
  private writeGeneration = 0
  /** Temp path of the write awaiting its rename; flushOrThrow removes it to veto that rename. */
  private inFlightTmpFile: string | null = null
  /** Set by flushAsync so the quit flush is the final write; see scheduleSave. */
  private quitFlushStarted = false

  constructor(dataFile: string, legacyActiveView: unknown) {
    this.file = getActiveViewPreferenceFile(dataFile)
    const storedActiveView = readActiveView(this.file)
    const fallbackActiveView = isTopLevelView(legacyActiveView) ? legacyActiveView : 'terminal'
    this.activeView = storedActiveView ?? fallbackActiveView
    this.persistedActiveView = storedActiveView
  }

  get(): TopLevelView {
    return this.activeView
  }

  set(value: unknown): boolean {
    if (!isTopLevelView(value)) {
      return false
    }
    const changed = value !== this.activeView
    this.activeView = value
    if (
      value !== this.persistedActiveView ||
      this.writeTimer !== null ||
      this.pendingWrite !== null
    ) {
      this.scheduleSave()
    }
    return changed
  }

  private scheduleSave(): void {
    // Why: the quit flush is the final write; a later debounce would land unawaited mid-exit.
    if (this.quitFlushStarted) {
      return
    }
    this.writeGeneration += 1
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.enqueueWrite(this.activeView, this.writeGeneration)
    }, SAVE_DEBOUNCE_MS)
  }

  private enqueueWrite(activeView: TopLevelView, generation: number): Promise<void> {
    const previousWrite = this.pendingWrite ?? Promise.resolve()
    const nextWrite = previousWrite
      .then(() => this.writeAsync(activeView, generation))
      .catch((error) => {
        console.error('[active-view] Failed to persist preference:', error)
      })
      .finally(() => {
        if (this.pendingWrite === nextWrite) {
          this.pendingWrite = null
        }
      })
    this.pendingWrite = nextWrite
    return nextWrite
  }

  private async writeAsync(activeView: TopLevelView, generation: number): Promise<void> {
    const tmpFile = `${this.file}.${process.pid}.${generation}.tmp`
    let renamed = false
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmpFile, serializeActiveView(activeView), 'utf-8')
      // Every async writer chains on pendingWrite, so a stale generation can only lose
      // here. Sync flushOrThrow skips that chain, which is what the temp-path claim below
      // covers — past this point the generation guard is spent.
      if (generation !== this.writeGeneration) {
        return
      }
      this.inFlightTmpFile = tmpFile
      try {
        await rename(tmpFile, this.file)
        renamed = true
        this.persistedActiveView = activeView
      } catch (err) {
        // ENOENT: flushOrThrow removed this temp file because it already wrote a fresher view.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      } finally {
        if (this.inFlightTmpFile === tmpFile) {
          this.inFlightTmpFile = null
        }
      }
    } finally {
      if (!renamed) {
        await rm(tmpFile).catch(() => {})
      }
    }
  }

  flushOrThrow(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    const asyncWriteWasInFlight = this.pendingWrite !== null
    this.writeGeneration += 1
    this.pendingWrite = null
    if (!asyncWriteWasInFlight && this.activeView === this.persistedActiveView) {
      return
    }
    // Why remove it: an async writer parked on `await rename` has already cleared the
    // generation guard, so deleting what it would rename is the only thing stopping a
    // stale view from landing on top of the write below.
    if (this.inFlightTmpFile) {
      try {
        unlinkSync(this.inFlightTmpFile)
      } catch {
        // Already renamed or never created.
      }
      this.inFlightTmpFile = null
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmpFile = `${this.file}.${process.pid}.${this.writeGeneration}.tmp`
    writeFileSync(tmpFile, serializeActiveView(this.activeView), 'utf-8')
    renameSync(tmpFile, this.file)
    this.persistedActiveView = this.activeView
  }

  /** Async twin of flushOrThrow() for the quit path; never throws so it can join the teardown barrier. */
  flushAsync(): Promise<void> {
    this.quitFlushStarted = true
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    // Why still write when a write is already in flight: that one may carry a stale view,
    // and its generation guard would drop it — matching flushOrThrow's `force` reasoning.
    if (this.pendingWrite === null && this.activeView === this.persistedActiveView) {
      return Promise.resolve()
    }
    this.writeGeneration += 1
    return this.enqueueWrite(this.activeView, this.writeGeneration)
  }

  async waitForPendingWrite(): Promise<void> {
    if (this.pendingWrite) {
      await this.pendingWrite
    }
  }
}
