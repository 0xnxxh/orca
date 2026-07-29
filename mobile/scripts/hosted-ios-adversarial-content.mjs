import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { HOSTED_ADVERSARIAL_CONTENT_MARKER } from './hosted-adversarial-repository-fixture.mjs'
import {
  captureHostedWebViewAdversarialObservation,
  hostedWebViewAdversarialContentObservations
} from './hosted-webview-adversarial-content.mjs'
import { inspectHostedWebViewAdversarialFiles } from './hosted-webview-adversarial-files.mjs'
import { readHostedWebViewTextPoint } from './hosted-webview-cdp-session.mjs'
import { tapHostedIosPoint } from './hosted-ios-emulator-accessibility.mjs'
import { registerWorktreeForPairingRuntime } from './start-emulator-pairing-runtime.mjs'

const execFileAsync = promisify(execFile)

export async function registerHostedIosAdversarialRepository(
  { fixture, orcaCli, pairingRuntimeUserDataPath },
  runCli = execFileAsync
) {
  const env = {
    ...process.env,
    ORCA_DEV_USER_DATA_PATH: pairingRuntimeUserDataPath,
    ORCA_USER_DATA_PATH: pairingRuntimeUserDataPath
  }
  await registerWorktreeForPairingRuntime({ env }, fixture.root, {
    logStep: () => {},
    logSuccess: () => {},
    orca: async (args, options) => {
      const result = await runCli(orcaCli, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env,
        timeout: options.timeout
      })
      return {
        stdout: String(result.stdout).trim(),
        stderr: String(result.stderr).trim()
      }
    }
  })
}

export function createHostedIosAdversarialContentInspector({ emulator, fixture, timeoutMs }) {
  const observations = []
  let reviewDocument
  return {
    async inspect({ document, phase }) {
      if (phase === 'sessionDiff') {
        const point = await readHostedWebViewTextPoint(document, fixture.filename)
        await tapHostedIosPoint(emulator, point)
        await delay(250)
      }
      observations.push(
        await captureHostedWebViewAdversarialObservation({
          document,
          expectedMarker: phase === 'sessionDiff' ? HOSTED_ADVERSARIAL_CONTENT_MARKER : undefined,
          timeoutMs: Math.min(timeoutMs, 15_000)
        })
      )
      if (phase === 'review') {
        reviewDocument = document
      }
    },
    async evidence() {
      if (!reviewDocument) {
        throw new Error('Hosted iOS adversarial Review document is unavailable')
      }
      return {
        ...hostedWebViewAdversarialContentObservations(observations),
        ...(await inspectHostedWebViewAdversarialFiles({
          document: reviewDocument,
          fixture,
          timeoutMs
        }))
      }
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
