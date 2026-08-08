import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { E2EE_KEYPAIR_FILENAME } from '../runtime/mobile-pairing-files'
import { loadTerminalAuthorityConsumerProofKeypair } from './terminal-authority-consumer-proof-keypair'
import {
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityHostAppConsumerId
} from './terminal-session-authority-consumer-proof'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('terminal authority consumer proof identity keypair', () => {
  it('persists one identity and fails closed after its key is lost', () => {
    const directory = freshDirectory()
    const first = loadTerminalAuthorityConsumerProofKeypair(directory)
    const consumerId = terminalAuthorityHostAppConsumerId(
      'authority-host:keypair-test',
      first.publicKey
    )

    expect(
      terminalAuthorityHostAppConsumerId(
        'authority-host:keypair-test',
        loadTerminalAuthorityConsumerProofKeypair(directory).publicKey
      )
    ).toBe(consumerId)
    rmSync(join(directory, E2EE_KEYPAIR_FILENAME))

    expect(() => loadTerminalAuthorityConsumerProofKeypair(directory)).toThrow(
      'Established E2EE identity is missing'
    )
  })

  it('rejects corruption and a valid replacement instead of rotating identity', () => {
    const corruptDirectory = freshDirectory()
    writeFileSync(join(corruptDirectory, E2EE_KEYPAIR_FILENAME), '{invalid', 'utf8')

    expect(() => loadTerminalAuthorityConsumerProofKeypair(corruptDirectory)).toThrow(
      'E2EE keypair is invalid'
    )
    expect(readFileSync(join(corruptDirectory, E2EE_KEYPAIR_FILENAME), 'utf8')).toBe('{invalid')

    const replacedDirectory = freshDirectory()
    loadTerminalAuthorityConsumerProofKeypair(replacedDirectory)
    const replacement = createTerminalAuthorityProofEphemeralKeypair()
    writeFileSync(
      join(replacedDirectory, E2EE_KEYPAIR_FILENAME),
      JSON.stringify({
        v: 1,
        publicKeyB64: Buffer.from(replacement.publicKey).toString('base64'),
        secretKeyB64: Buffer.from(replacement.secretKey).toString('base64')
      }),
      'utf8'
    )

    expect(() => loadTerminalAuthorityConsumerProofKeypair(replacedDirectory)).toThrow(
      'does not match the keypair'
    )
  })
})

function freshDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-authority-proof-keypair-'))
  directories.push(directory)
  return directory
}
