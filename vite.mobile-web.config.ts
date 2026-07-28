import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createMobileWebContentAddressedPlugin } from './config/build-plugins/mobile-web-content-addressed'
import { createMobileWebImportBoundaryPlugin } from './config/build-plugins/mobile-web-import-boundary'
import { createMobileWebStyleBoundaryPlugin } from './config/build-plugins/mobile-web-style-boundary'

export default defineConfig({
  root: resolve('src/mobile-web'),
  base: './',
  plugins: [
    createMobileWebImportBoundaryPlugin(),
    createMobileWebStyleBoundaryPlugin(),
    react(),
    tailwindcss(),
    createMobileWebContentAddressedPlugin()
  ],
  resolve: {
    alias: {
      '@mobile-web': resolve('src/mobile-web/src'),
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: resolve('out/mobile-web'),
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: resolve('src/mobile-web/index.html'),
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/application.js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
})
