import { vi } from 'vitest';

// `createQuery()` resolves its `QueryClient` via `getContext()`/`setContext()`
// internally (see `@tanstack/svelte-query`'s `context.js`), which normally
// requires running inside a Svelte component. Backing them with a plain Map
// lets tests provide a `QueryClient` via `setQueryClientContext()` without a
// real component tree.
vi.mock('svelte', async () => {
  const actual: object = await vi.importActual('svelte');
  const context = new Map<unknown, unknown>();

  return {
    ...actual,
    getContext: vi.fn((key: unknown) => context.get(key)),
    setContext: vi.fn((key: unknown, value: unknown) => {
      context.set(key, value);
      return value;
    })
  };
});
