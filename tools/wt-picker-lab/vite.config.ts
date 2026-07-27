import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repoRoot = resolve(import.meta.dirname, '../..')

/** Records the picked design to disk so the agent session can read the choice. */
function recordPickPlugin(): Plugin {
  return {
    name: 'wt-picker-lab-record-pick',
    configureServer(server) {
      server.middlewares.use('/__lab/pick', (req, res) => {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          try {
            const { id } = JSON.parse(body || '{}')
            if (typeof id === 'string') {
              writeFileSync(resolve(import.meta.dirname, 'PICK.txt'), `${id}\n`, 'utf8')
              server.config.logger.info(`\n  ✓ picked design: ${id}\n`)
            }
          } catch {
            // Recording a pick is best-effort; the UI already stored it locally.
          }
          res.statusCode = 204
          res.end()
        })
      })
    }
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), recordPickPlugin()],
  define: {
    ORCA_FEATURE_WALL_ENABLED: 'false'
  },
  resolve: {
    alias: {
      '@renderer': resolve(repoRoot, 'src/renderer/src'),
      '@': resolve(repoRoot, 'src/renderer/src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    fs: { allow: [repoRoot] }
  }
})
