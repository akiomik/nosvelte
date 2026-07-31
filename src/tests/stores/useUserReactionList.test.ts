import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useUserReactionList } from '$lib/stores/useUserReactionList.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useUserReactionList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('keeps every distinct reaction, deduplicating only by event id', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9313');

    const result = useUserReactionList(rxNostr, ['useUserReactionList'], 'p1', 10);
    activate(result.status);
    activate(result.data);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual([
      'REQ',
      subId,
      { kinds: [7], authors: ['p1'], limit: 10 }
    ]);

    // Reactions are regular events. These three share nothing that identifies
    // them as versions of one another: one carries no tags at all, and the two
    // tagged ones lead with the same `p` tag while pointing at different notes.
    const untagged = fakeEvent({ id: 'r1', kind: 7, pubkey: 'p1', created_at: 300, content: '+' });
    const toNote1 = fakeEvent({
      id: 'r2',
      kind: 7,
      pubkey: 'p1',
      created_at: 200,
      content: '+',
      tags: [
        ['p', 'author'],
        ['e', 'note-1']
      ]
    });
    const toNote2 = fakeEvent({
      id: 'r3',
      kind: 7,
      pubkey: 'p1',
      created_at: 100,
      content: '+',
      tags: [
        ['p', 'author'],
        ['e', 'note-2']
      ]
    });

    respondWithEvent(server, subId, untagged);
    await waitFor(result.data, (v) => v.length === 1);
    respondWithEvent(server, subId, toNote1);
    await waitFor(result.data, (v) => v.length === 2);
    respondWithEvent(server, subId, toNote2);
    await waitFor(result.data, (v) => v.length === 3);

    // A resend of one of them is still a duplicate.
    respondWithEvent(server, subId, toNote1);
    respondWithEose(server, subId);

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data).map((p) => p.event)).toEqual([untagged, toNote1, toNote2]);
  });
});
