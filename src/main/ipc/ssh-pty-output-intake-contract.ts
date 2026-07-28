import type { LegacySshProjectionSemantics } from './ssh-pty-legacy-projection'
import type {
  SshPtyModelAdmissionOptions,
  SshPtyModelAdmissionReceipt
} from './ssh-pty-model-admission-contract'

export type SshPtyOutputDataEvent = Readonly<{
  id: string
  data: string
  providerGeneration: number
  ptyIncarnation: string
  rawLength: number
  transformed: boolean
  sequence?: number
}>

export type SshPtyOutputExitEvent = Readonly<{
  id: string
  code: number
  providerGeneration: number
  ptyIncarnation: string
}>

export type SshPtyOutputReceipt = SshPtyModelAdmissionReceipt &
  Readonly<{ projection: LegacySshProjectionSemantics }>

export type SshPtyOutputIntakeDependencies = {
  getModelSequence: (id: string) => number
  acceptModel: (event: SshPtyOutputDataEvent) => { sequence: number; completion: Promise<void> }
  project: (event: SshPtyOutputDataEvent, projection: LegacySshProjectionSemantics) => void
  prepareExit: (event: SshPtyOutputExitEvent) => void
  finalizeExit: (event: SshPtyOutputExitEvent) => void
  pauseProvider?: (providerGeneration: number, id: string) => boolean
  resumeProvider?: (providerGeneration: number, id: string) => void
  closeProvider?: (providerGeneration: number, reason: string) => void
  onGenerationClosed?: (providerGeneration: number, reason: string) => void
}

export type SshPtyOutputIntakeOptions = SshPtyModelAdmissionOptions & {
  exitBarrierMs?: number
}
