import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useMetadataList } from '$lib/stores/useMetadataList.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useMetadataList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('keeps one entry per pubkey when an updated metadata arrives', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9312');
    const pubkeys = ['p1', 'p2'];

    const result = useMetadataList(rxNostr, ['useMetadataList'], pubkeys);
    activate(result.status);
    activate(result.data);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual([
      'REQ',
      subId,
      { kinds: [0], authors: pubkeys, limit: pubkeys.length }
    ]);

    const stale = fakeEvent({ id: 'm1', kind: 0, pubkey: 'p1', created_at: 1, content: 'stale' });
    respondWithEvent(server, subId, stale);
    await waitFor(result.data, (v) => v.length === 1);

    const other = fakeEvent({ id: 'm2', kind: 0, pubkey: 'p2', created_at: 1 });
    respondWithEvent(server, subId, other);
    await waitFor(result.data, (v) => v.length === 2);

    // An update for a pubkey already in the list must replace its entry, not
    // sit next to the event it supersedes.
    const fresh = fakeEvent({ id: 'm3', kind: 0, pubkey: 'p1', created_at: 2, content: 'fresh' });
    respondWithEvent(server, subId, fresh);
    await waitFor(result.data, (v) => v.some((p) => p.event.id === fresh.id));

    respondWithEose(server, subId);
    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data).map((p) => p.event)).toEqual([fresh, other]);
  });
});
