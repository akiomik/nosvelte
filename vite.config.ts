import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/tests/**/*.test.{js,ts}'],
    setupFiles: ['src/tests/setup.ts']
  }
});
