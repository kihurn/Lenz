import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') }, output: { format: 'cjs' } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          region: resolve(__dirname, 'src/renderer/region.html')
        }
      }
    }
  }
})
