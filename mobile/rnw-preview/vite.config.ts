import { defineConfig } from 'vite'
import path from 'node:path'

const harnessDir = import.meta.dirname
const mobileRoot = path.resolve(harnessDir, '..')

// Interactive harness: mounts the REAL native-chat hooks + components. Only the
// OS boundary is faked — the photo picker (picker-stub) and the RPC socket
// (fake-rpc). Everything else is the actual production code reacting to clicks.
export default defineConfig({
  root: harnessDir,
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      { find: /^react-native\//, replacement: 'react-native-web/' },
      { find: 'lucide-react-native', replacement: path.join(harnessDir, 'lucide-stub.tsx') },
      { find: 'expo-clipboard', replacement: path.join(harnessDir, 'expo-clipboard-stub.ts') },
      { find: /^.*\/MobileMarkdown$/, replacement: path.join(harnessDir, 'markdown-stub.tsx') },
      {
        find: /^.*mobile-image-source-picker$/,
        replacement: path.join(harnessDir, 'picker-stub.ts')
      }
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json']
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    __DEV__: 'true',
    global: 'globalThis'
  },
  server: { port: 5199, fs: { allow: [mobileRoot] } }
})
