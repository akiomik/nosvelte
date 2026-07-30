/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { RxNostr } from 'rx-nostr';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { app } from '$lib/stores/index.js';

import { createTestRelay, fakeEvent, nextReqSubId, respondWithEvent } from '../helpers/relay.js';
import EventHost from './fixtures/EventHost.svelte';

describe('Event', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  });

  afterEach(() => {
    WS.clean();
  });

  it('renders the loading slot, then the default slot once the event resolves', async () => {
    const { rxNostr, server } = createTestRelay('ws://localhost:9401');
    app.set({ rxNostr });
    const id = 'target-id';

    render(EventHost, { queryKey: ['Event'], id });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');

    const subId = await nextReqSubId(server);
    const event = fakeEvent({ id });
    respondWithEvent(server, subId, event);

    const defaultSlot = await screen.findByTestId('default');
    expect(JSON.parse(defaultSlot.textContent ?? '')).toEqual({ event, status: 'success' });
  });

  it('renders the nodata slot when the app has no default relays', async () => {
    const rxNostr = { getDefaultRelays: () => ({}) } as unknown as RxNostr;
    app.set({ rxNostr });

    render(EventHost, { queryKey: ['Event-nodata'], id: 'any-id' });

    expect(await screen.findByTestId('nodata')).toHaveTextContent('nodata');
  });
});
