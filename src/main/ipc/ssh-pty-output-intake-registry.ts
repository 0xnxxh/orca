import type { SshPtyOutputIntake } from './ssh-pty-output-intake'
import type {
  SshPtyOutputDataEvent,
  SshPtyOutputExitEvent,
  SshPtyOutputReceipt
} from './ssh-pty-output-intake-contract'

let installedIntake: SshPtyOutputIntake | null = null
let nextProviderGeneration = 1

export function allocateSshPtyProviderGeneration(): number {
  return nextProviderGeneration++
}

export function installSshPtyOutputIntake(intake: SshPtyOutputIntake): () => void {
  const previous = installedIntake
  installedIntake = intake
  previous?.dispose()
  return () => {
    if (installedIntake === intake) {
      installedIntake = null
      intake.dispose()
    }
  }
}

export function acceptSshPtyOutputData(event: SshPtyOutputDataEvent): Promise<SshPtyOutputReceipt> {
  return installedIntake
    ? installedIntake.acceptData(event)
    : Promise.reject(outputIntakeUnavailableError())
}

export function acceptSshPtyOutputExit(event: SshPtyOutputExitEvent): Promise<void> {
  return installedIntake
    ? installedIntake.acceptExit(event)
    : Promise.reject(outputIntakeUnavailableError())
}

export function closeSshPtyOutputGeneration(providerGeneration: number, reason: string): void {
  installedIntake?.closeGeneration(providerGeneration, reason)
}

function outputIntakeUnavailableError(): Error {
  return Object.assign(new Error('ssh_output_intake_unavailable'), {
    code: 'ssh_output_intake_unavailable'
  })
}
