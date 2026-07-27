import {
  resolveCodexSessionResumeProvenance,
  type CodexSessionResumePreparation
} from './codex-session-resume-home'

export type VerifiedCodexResumeSource = { homePath: string; transcriptPath: string }

/**
 * The launch decision for an automatic Codex resume: pin the verified origin home, or
 * fall back to a fresh session whose resume argv the PTY layer drops (#10793). The
 * caller supplies `resolveVerifiedResumeHome` because migration, project trust and hook
 * repair only run once provenance is verified — a fresh outcome must skip all of them.
 */
export async function prepareCodexSessionResume(args: {
  sessionId: string
  transcriptPath: string | undefined
  trustedCodexHomes: readonly string[]
  resolveVerifiedResumeHome: (source: VerifiedCodexResumeSource) => Promise<string>
  fileIsRegular?: (filePath: string) => boolean
  listSessionFiles?: (sessionsRoot: string) => AsyncIterable<string>
}): Promise<CodexSessionResumePreparation> {
  const provenance = await resolveCodexSessionResumeProvenance({
    sessionId: args.sessionId,
    transcriptPath: args.transcriptPath,
    trustedCodexHomes: args.trustedCodexHomes,
    ...(args.fileIsRegular ? { fileIsRegular: args.fileIsRegular } : {}),
    ...(args.listSessionFiles ? { listSessionFiles: args.listSessionFiles } : {})
  })
  if (provenance.outcome === 'fresh') {
    return provenance
  }
  return {
    outcome: 'resume',
    codexHomePath: await args.resolveVerifiedResumeHome({
      homePath: provenance.homePath,
      transcriptPath: provenance.transcriptPath
    })
  }
}
