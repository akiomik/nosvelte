import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  // Vitest runs test files in SSR mode by default, which resolves package
  // exports via the `node`/`import` conditions instead of `browser`. Without
  // this, Svelte 5 resolves to its server build, whose `mount()` throws
  // "not available on the server" when testing-library tries to render a
  // component into jsdom.
  ...(process.env['VITEST'] ? { resolve: { conditions: ['browser'] } } : {}),
  test: {
    environment: 'jsdom',
    include: ['src/tests/**/*.test.{js,ts}'],
    setupFiles: ['src/tests/setup.ts']
  }
});
