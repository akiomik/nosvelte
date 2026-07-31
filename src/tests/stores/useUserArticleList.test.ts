import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useUserArticleList } from '$lib/stores/useUserArticleList.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

const article = (id: string, identifier: string, created_at: number) =>
  fakeEvent({
    id,
    kind: 30023,
    pubkey: 'p1',
    created_at,
    tags: [
      ['t', 'nostr'],
      ['d', identifier]
    ]
  });

describe('useUserArticleList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('keeps one entry per article, replacing an article with its newer revision', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9314');

    const result = useUserArticleList(rxNostr, ['useUserArticleList'], 'p1', 10);
    activate(result.status);
    activate(result.data);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual([
      'REQ',
      subId,
      { kinds: [30023], authors: ['p1'], limit: 10 }
    ]);

    // Two distinct articles that lead with the same tag, newest first as a
    // relay would send them.
    const first = article('a1', 'article-1', 200);
    respondWithEvent(server, subId, first);
    await waitFor(result.data, (v) => v.length === 1);

    const second = article('a2', 'article-2', 100);
    respondWithEvent(server, subId, second);
    await waitFor(result.data, (v) => v.length === 2);

    // A revision of the first article replaces it rather than joining it.
    const revised = article('a3', 'article-1', 300);
    respondWithEvent(server, subId, revised);
    await waitFor(result.data, (v) => v.some((p) => p.event.id === revised.id));

    respondWithEose(server, subId);
    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data).map((p) => p.event)).toEqual([revised, second]);
  });
});
