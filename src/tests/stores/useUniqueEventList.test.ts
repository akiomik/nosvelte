import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { createRxNostr } from 'rx-nostr';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useUniqueEventList } from '$lib/stores/useUniqueEventList.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useUniqueEventList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('requests the given filters and accumulates events, deduplicating by id', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9304');
    const filters = [{ kinds: [1] }];

    const result = useUniqueEventList(rxNostr, ['useUniqueEventList'], filters);
    activate(result.status);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual(['REQ', subId, filters[0]]);

    const first = fakeEvent({ id: 'e1' });
    respondWithEvent(server, subId, first);
    await waitFor(result.data, (v) => v.length === 1);

    const second = fakeEvent({ id: 'e2' });
    respondWithEvent(server, subId, second);
    const twoEvents = await waitFor(result.data, (v) => v.length === 2);
    expect(twoEvents.map((p) => p.event)).toEqual([first, second]);

    // A duplicate id is deduplicated and must not grow the accumulated list.
    respondWithEvent(server, subId, fakeEvent({ id: 'e1', content: 'duplicate' }));
    respondWithEose(server, subId);

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data).map((p) => p.event)).toEqual([first, second]);
  });

  it('emits an empty list when the REQ matches no events', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9305');

    const result = useUniqueEventList(rxNostr, ['useUniqueEventList', 'empty'], [{ kinds: [1] }]);
    activate(result.status);
    activate(result.data);

    respondWithEose(server, await nextReqSubId(server));

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data)).toEqual([]);
  });

  it('emits an empty list when no relays are configured', () => {
    const rxNostr = createRxNostr();

    const result = useUniqueEventList(
      rxNostr,
      ['useUniqueEventList', 'no-relays'],
      [{ kinds: [1] }]
    );

    // The relay-less early return hands back `initData` verbatim, so omitting
    // it would break the `EventPacket[]` contract with `undefined`.
    expect(get(result.data)).toEqual([]);
    expect(get(result.status)).toBe('success');
  });
});
