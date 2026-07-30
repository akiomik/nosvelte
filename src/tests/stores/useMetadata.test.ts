import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useMetadata } from '$lib/stores/useMetadata.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useMetadata', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('requests kind-0 events for the given pubkey and keeps only the newest one', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9303');
    const pubkey = 'p1';

    const result = useMetadata(rxNostr, ['useMetadata'], pubkey);
    activate(result.status);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual([
      'REQ',
      subId,
      { kinds: [0], authors: [pubkey], limit: 1 }
    ]);

    const first = fakeEvent({ id: 'e1', kind: 0, pubkey, created_at: 1 });
    respondWithEvent(server, subId, first);
    const data = await waitFor(result.data, (v) => v !== undefined);
    expect(data?.event).toEqual(first);

    // Newer replaces the current value.
    const newer = fakeEvent({ id: 'e2', kind: 0, pubkey, created_at: 2 });
    respondWithEvent(server, subId, newer);
    await waitFor(result.data, (v) => v?.event.id === 'e2');

    // Ignored: stale (older) update, wrong kind, and wrong pubkey.
    respondWithEvent(server, subId, fakeEvent({ id: 'e3', kind: 0, pubkey, created_at: 1 }));
    respondWithEvent(server, subId, fakeEvent({ id: 'e4', kind: 1, pubkey, created_at: 3 }));
    respondWithEvent(
      server,
      subId,
      fakeEvent({ id: 'e5', kind: 0, pubkey: 'other', created_at: 3 })
    );
    respondWithEose(server, subId);

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data)?.event).toEqual(newer);
  });
});
