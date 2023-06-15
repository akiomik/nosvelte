import { vi } from 'vitest';

vi.mock('@tanstack/svelte-query', async () => {
  const actual: object = await vi.importActual('@tanstack/svelte-query');
  const useQueryClient = vi.fn();

  return { ...actual, useQueryClient };
});
