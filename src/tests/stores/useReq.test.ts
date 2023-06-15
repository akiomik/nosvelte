import { QueryClient, useQueryClient } from '@tanstack/svelte-query';
import { createRxNostr } from 'rx-nostr';
import { pipe } from 'rxjs';
import type { Readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReq } from '$lib/stores/useReq.js';

function toArray<A>(store: Readable<A>, timeout: number): Promise<A[]> {
  return new Promise((resolve) => {
    const xs: A[] = [];
    store.subscribe((x) => xs.push(x));
    setTimeout(() => resolve(xs), timeout);
  });
}

describe('useReq', () => {
  const queryKey = ['useReq'];
  const rxNostr = createRxNostr();
  const filters = [{}];
  const operator = pipe();
  const initData = undefined;

  beforeEach(() => {
    useQueryClient.mockImplementation(() => new QueryClient());
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('when relays are empty', () => {
    it('emits initData as .data', async () => {
      const initData = {};
      const result = useReq({ rxNostr, queryKey, filters, operator, initData });
      const actual = await toArray(result.data, 250);
      expect(actual).toEqual([initData]);
    });

    it('emits "success" as .status', async () => {
      const result = useReq({ rxNostr, queryKey, filters, operator, initData });
      const actual = await toArray(result.status, 250);
      expect(actual).toEqual(['success']);
    });

    it('emits undefined as .error', async () => {
      const result = useReq({ rxNostr, queryKey, filters, operator, initData });
      const actual = await toArray(result.error, 250);
      expect(actual).toEqual([undefined]);
    });
  });
});
