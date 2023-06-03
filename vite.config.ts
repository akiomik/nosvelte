import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: './src/main.ts',
      name: 'svelte-nostr',
      fileName: 'index',
      formats: ["es", "cjs", "umd"],
    }
  }
})
