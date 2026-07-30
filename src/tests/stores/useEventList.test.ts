import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useEventList } from '$lib/stores/useEventList.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useEventList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('requests the given ids and accumulates matching kind-1 events, deduplicating and ignoring others', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9302');
    const ids = ['a', 'b'];

    const result = useEventList(rxNostr, ['useEventList'], ids);
    activate(result.status);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual(['REQ', subId, { ids, limit: ids.length }]);

    const eventA = fakeEvent({ id: 'a', kind: 1 });
    respondWithEvent(server, subId, eventA);
    await waitFor(result.data, (v) => v.length === 1);

    const eventB = fakeEvent({ id: 'b', kind: 1 });
    respondWithEvent(server, subId, eventB);
    const twoEvents = await waitFor(result.data, (v) => v.length === 2);
    expect(twoEvents.map((p) => p.event)).toEqual([eventA, eventB]);

    // Ignored: duplicate id, id not in the requested list, and wrong kind.
    respondWithEvent(server, subId, fakeEvent({ id: 'a', kind: 1, content: 'duplicate' }));
    respondWithEvent(server, subId, fakeEvent({ id: 'z', kind: 1 }));
    respondWithEvent(server, subId, fakeEvent({ id: 'a', kind: 0 }));
    respondWithEose(server, subId);

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data).map((p) => p.event)).toEqual([eventA, eventB]);
  });
});
