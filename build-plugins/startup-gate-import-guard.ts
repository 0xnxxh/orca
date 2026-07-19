import { relative, resolve, sep } from 'node:path'
import type { OutputBundle, OutputChunk, Plugin } from 'rollup'

const ALLOWED_SOURCE_MODULES = new Set([
  'src/main/index.ts',
  'src/main/startup/mac-update-install-fence-gate.ts',
  'src/main/mac-bundle-plist.ts',
  'src/main/mac-update-install-fence-storage.ts',
  'src/main/mac-update-install-fence-diagnostics.ts',
  'src/main/mac-update-install-processes.ts',
  'src/shared/mac-update-install-fence.ts',
  'src/shared/secure-file.ts'
])

export function createStartupGateImportGuardPlugin(): Plugin {
  return {
    name: 'orca-startup-gate-import-guard',
    generateBundle(_options, bundle: OutputBundle) {
      const entry = Object.values(bundle).find(
        (item): item is OutputChunk =>
          item.type === 'chunk' && item.isEntry && item.name === 'index'
      )
      if (!entry) {
        // Why: a silently skipped guard would let entry-side imports decay
        // unnoticed if the entry chunk is ever renamed; fail the build instead.
        throw new Error(
          '[startup-gate-import-guard] no entry chunk named "index" found; the guard cannot verify the startup gate'
        )
      }
      const chunks = new Map(
        Object.values(bundle)
          .filter((item): item is OutputChunk => item.type === 'chunk')
          .map((chunk) => [chunk.fileName, chunk])
      )
      const unexpected = new Set<string>()
      for (const chunk of collectStaticChunks(entry, chunks)) {
        for (const moduleId of Object.keys(chunk.modules)) {
          const sourcePath = toSourcePath(moduleId)
          if (sourcePath?.startsWith('src/') && !ALLOWED_SOURCE_MODULES.has(sourcePath)) {
            unexpected.add(sourcePath)
          }
        }
      }
      if (unexpected.size > 0) {
        throw new Error(
          '[startup-gate-import-guard] the early bootstrap statically reaches application ' +
            `modules: ${[...unexpected].sort().join(', ')}. Load the real main graph only ` +
            'through the guarded dynamic import.'
        )
      }
    }
  }
}

function collectStaticChunks(entry: OutputChunk, chunks: Map<string, OutputChunk>): OutputChunk[] {
  const result: OutputChunk[] = []
  const pending = [entry]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const chunk = pending.pop() as OutputChunk
    if (seen.has(chunk.fileName)) {
      continue
    }
    seen.add(chunk.fileName)
    result.push(chunk)
    for (const imported of chunk.imports) {
      const importedChunk = chunks.get(imported)
      if (importedChunk) {
        pending.push(importedChunk)
      }
    }
  }
  return result
}

function toSourcePath(moduleId: string): string | null {
  const workspaceRoot = resolve('.')
  const normalized = relative(workspaceRoot, moduleId).split(sep).join('/')
  return normalized.startsWith('../') ? null : normalized
}
