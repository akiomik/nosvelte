/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { RxNostr } from 'rx-nostr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { app } from '$lib/stores/index.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import EventListHost from './fixtures/EventListHost.svelte';

describe('EventList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('renders the loading slot, then accumulates matching events into the default slot', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9403');
    app.set({ rxNostr });
    const ids = ['a', 'b'];

    render(EventListHost, { queryKey: ['EventList'], ids });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');

    const subId = await nextReqSubId(server);
    const eventA = fakeEvent({ id: 'a' });
    respondWithEvent(server, subId, eventA);

    const oneEvent = await screen.findByTestId('default');
    expect(JSON.parse(oneEvent.textContent ?? '')).toEqual({
      events: [eventA],
      status: 'success'
    });

    const eventB = fakeEvent({ id: 'b' });
    respondWithEvent(server, subId, eventB);
    respondWithEose(server, subId);

    await vi.waitFor(() => {
      const defaultSlot = screen.getByTestId('default');
      expect(JSON.parse(defaultSlot.textContent ?? '').events).toEqual([eventA, eventB]);
    });
  });

  it('renders the nodata slot when the app has no default relays', async () => {
    const rxNostr = { getDefaultRelays: () => ({}) } as unknown as RxNostr;
    app.set({ rxNostr });

    render(EventListHost, { queryKey: ['EventList-nodata'], ids: ['a'] });

    expect(await screen.findByTestId('nodata')).toHaveTextContent('nodata');
  });
});
