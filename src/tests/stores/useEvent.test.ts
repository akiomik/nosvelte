import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useEvent } from '$lib/stores/useEvent.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useEvent', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('requests the given id and resolves with the matching event, ignoring duplicates', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9301');
    const id = 'target-id';

    const result = useEvent(rxNostr, ['useEvent'], id);
    activate(result.status);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual(['REQ', subId, { ids: [id], limit: 1 }]);

    const event = fakeEvent({ id });
    respondWithEvent(server, subId, event);
    const data = await waitFor(result.data, (v) => v !== undefined);
    expect(data?.event).toEqual(event);

    // A second EVENT with the same id is deduplicated by `uniq()` and never
    // reaches the query, so .data must not change.
    respondWithEvent(server, subId, fakeEvent({ id, content: 'duplicate-should-be-ignored' }));
    respondWithEose(server, subId);

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data)?.event).toEqual(event);
  });
});
