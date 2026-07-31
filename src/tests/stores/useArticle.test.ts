import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useArticle } from '$lib/stores/useArticle.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, waitFor } from '../helpers/store.js';

describe('useArticle', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('resolves the article whose "d" tag matches, whatever its position', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9310');
    const identifier = 'my-article';

    const result = useArticle(rxNostr, ['useArticle'], 'p1', identifier);
    activate(result.status);
    activate(result.data);

    const subId = await nextReqSubId(server);
    expect(server.messages.at(-1)).toEqual([
      'REQ',
      subId,
      { kinds: [30023], authors: ['p1'], '#d': [identifier], limit: 1 }
    ]);

    // Long-form clients commonly emit `title` before `d`.
    const event = fakeEvent({
      kind: 30023,
      pubkey: 'p1',
      tags: [
        ['title', 'My Article'],
        ['d', identifier]
      ]
    });
    respondWithEvent(server, subId, event);

    const data = await waitFor(result.data, (v) => v !== undefined);
    expect(data?.event).toEqual(event);

    respondWithEose(server, subId);
    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
  });

  it('ignores an article of the same kind and author with a different identifier', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9311');

    const result = useArticle(rxNostr, ['useArticle', 'other'], 'p1', 'wanted');
    activate(result.status);
    activate(result.data);

    const subId = await nextReqSubId(server);
    respondWithEvent(
      server,
      subId,
      fakeEvent({ kind: 30023, pubkey: 'p1', tags: [['d', 'not-wanted']] })
    );
    respondWithEose(server, subId);

    expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    expect(get(result.data)).toBeUndefined();
  });
});
