import { Session } from 'node:inspector'
import { performance } from 'node:perf_hooks'
import type { GitStatusEntry, GitStatusResult } from '../../src/shared/types'
import { GitStatusReadLeaseOwner } from '../../src/main/git/git-status-read-lease-owner'
import {
  GitRepositorySnapshotOwner,
  type GitRepositoryStatusIdentity
} from '../../src/main/git/git-repository-snapshot-owner'

type Arm = 'lease-only' | 'snapshot-owner'
type Measurement = { cpuMicrosecondsPerRead: number; wallMicrosecondsPerRead: number }
type HeapProfileNode = { selfSize: number; children?: HeapProfileNode[] }

const native = { kind: 'native' } as const
const statusIdentity: GitRepositoryStatusIdentity = {
  includeIgnored: false,
  reuseLineStats: false,
  bypassEffectiveUpstreamNegativeCache: false,
  limit: 1_000,
  sharedLinkPaths: []
}
const configurations = [
  { entries: 0, timingReads: 10_000, warmupReads: 2_000, allocationReads: 5_000 },
  { entries: 100, timingReads: 2_000, warmupReads: 400, allocationReads: 500 },
  { entries: 1_000, timingReads: 250, warmupReads: 50, allocationReads: 100 }
]
const timingRounds = 11
const allocationRounds = 7

function createStatusResult(entryCount: number): GitStatusResult {
  const entries: GitStatusEntry[] = Array.from({ length: entryCount }, (_, index) => ({
    path: `src/features/feature-${index}/index.ts`,
    status: 'modified',
    area: 'unstaged',
    added: index % 7,
    removed: index % 5
  }))
  return {
    entries,
    conflictOperation: 'unknown',
    head: '0123456789abcdef',
    branch: 'main',
    upstreamStatus: {
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 2,
      behind: 3,
      behindCommitsArePatchEquivalent: false
    }
  }
}

function createReader(arm: Arm, result: GitStatusResult): () => Promise<GitStatusResult> {
  if (arm === 'lease-only') {
    const owner = new GitStatusReadLeaseOwner<GitStatusResult>()
    return () => owner.lease('native:/repo', undefined, async () => result)
  }
  const owner = new GitRepositorySnapshotOwner()
  return () => owner.readStatus(native, '/repo', statusIdentity, undefined, async () => result)
}

async function runReads(read: () => Promise<GitStatusResult>, repetitions: number): Promise<void> {
  for (let index = 0; index < repetitions; index += 1) {
    await read()
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

async function measureTiming(
  read: () => Promise<GitStatusResult>,
  repetitions: number
): Promise<Measurement> {
  const startedCpu = process.cpuUsage()
  const startedWall = performance.now()
  await runReads(read, repetitions)
  const wallMilliseconds = performance.now() - startedWall
  const cpu = process.cpuUsage(startedCpu)
  return {
    cpuMicrosecondsPerRead: (cpu.user + cpu.system) / repetitions,
    wallMicrosecondsPerRead: (wallMilliseconds * 1_000) / repetitions
  }
}

function post<T>(session: Session, method: string, parameters?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, parameters, (error, result) => {
      if (error) {
        reject(error)
      } else {
        resolve(result as T)
      }
    })
  })
}

function sumSampledBytes(node: HeapProfileNode): number {
  return (
    node.selfSize +
    (node.children?.reduce((total, child) => total + sumSampledBytes(child), 0) ?? 0)
  )
}

async function measureSampledAllocation(
  read: () => Promise<GitStatusResult>,
  repetitions: number
): Promise<number> {
  globalThis.gc?.()
  const session = new Session()
  session.connect()
  try {
    await post(session, 'HeapProfiler.startSampling', {
      samplingInterval: 128,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true
    })
    await runReads(read, repetitions)
    const result = await post<{ profile: { head: HeapProfileNode } }>(
      session,
      'HeapProfiler.stopSampling'
    )
    return sumSampledBytes(result.profile.head) / repetitions
  } finally {
    session.disconnect()
  }
}

async function verifyCallerResult(result: GitStatusResult): Promise<object> {
  const owner = new GitRepositorySnapshotOwner()
  const before = JSON.stringify(result)
  const returned = await owner.readStatus(
    native,
    '/repo',
    statusIdentity,
    undefined,
    async () => result
  )
  const snapshot = owner.getSnapshot({
    executionIdentity: native,
    worktreePath: '/repo',
    statusIdentity
  })
  return {
    returnedOriginalReference: returned === result,
    callerResultUnchanged: JSON.stringify(result) === before,
    callerResultFrozen: Object.isFrozen(result),
    callerEntriesFrozen: Object.isFrozen(result.entries),
    snapshotFrozen: Object.isFrozen(snapshot),
    snapshotEntriesFrozen: Object.isFrozen(snapshot?.status.entries),
    snapshotEntryCopies: result.entries.every(
      (entry, index) => snapshot?.status.entries[index] !== entry
    )
  }
}

async function main(): Promise<void> {
  if (!globalThis.gc) {
    throw new Error('Run with node --expose-gc --import tsx')
  }

  const results = []
  for (const configuration of configurations) {
    const statusResult = createStatusResult(configuration.entries)
    const readers = {
      'lease-only': createReader('lease-only', statusResult),
      'snapshot-owner': createReader('snapshot-owner', statusResult)
    }
    await runReads(readers['lease-only'], configuration.warmupReads)
    await runReads(readers['snapshot-owner'], configuration.warmupReads)

    const timing: Record<Arm, Measurement[]> = {
      'lease-only': [],
      'snapshot-owner': []
    }
    for (let round = 0; round < timingRounds; round += 1) {
      const order: Arm[] =
        round % 2 === 0 ? ['lease-only', 'snapshot-owner'] : ['snapshot-owner', 'lease-only']
      for (const arm of order) {
        timing[arm].push(await measureTiming(readers[arm], configuration.timingReads))
      }
    }

    const sampledAllocation: Record<Arm, number[]> = {
      'lease-only': [],
      'snapshot-owner': []
    }
    for (let round = 0; round < allocationRounds; round += 1) {
      for (const arm of ['lease-only', 'snapshot-owner'] as const) {
        sampledAllocation[arm].push(
          await measureSampledAllocation(readers[arm], configuration.allocationReads)
        )
      }
    }

    const medianCpu = {
      'lease-only': median(timing['lease-only'].map((value) => value.cpuMicrosecondsPerRead)),
      'snapshot-owner': median(
        timing['snapshot-owner'].map((value) => value.cpuMicrosecondsPerRead)
      )
    }
    const medianWall = {
      'lease-only': median(timing['lease-only'].map((value) => value.wallMicrosecondsPerRead)),
      'snapshot-owner': median(
        timing['snapshot-owner'].map((value) => value.wallMicrosecondsPerRead)
      )
    }
    const medianAllocatedBytes = {
      'lease-only': median(sampledAllocation['lease-only']),
      'snapshot-owner': median(sampledAllocation['snapshot-owner'])
    }
    results.push({
      entries: configuration.entries,
      timingReadsPerRound: configuration.timingReads,
      timingRounds,
      allocationReadsPerRound: configuration.allocationReads,
      allocationRounds,
      medianCpuMicrosecondsPerRead: medianCpu,
      incrementalCpuMicrosecondsPerRead: medianCpu['snapshot-owner'] - medianCpu['lease-only'],
      medianWallMicrosecondsPerRead: medianWall,
      incrementalWallMicrosecondsPerRead: medianWall['snapshot-owner'] - medianWall['lease-only'],
      medianSampledAllocatedBytesPerRead: medianAllocatedBytes,
      incrementalSampledAllocatedBytesPerRead:
        medianAllocatedBytes['snapshot-owner'] - medianAllocatedBytes['lease-only'],
      immutablePublicationOperations: {
        entryCopies: configuration.entries,
        objectFreezeCalls: configuration.entries + 6
      },
      callerVerification: await verifyCallerResult(statusResult)
    })
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        results
      },
      null,
      2
    )
  )
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
