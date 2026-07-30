/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useText } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import TextHost from './fixtures/TextHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useText: vi.fn() };
});

const useTextMock = vi.mocked(useText);

describe('Text', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useTextMock.mockReset();
  });

  it('calls useText with the given rxNostr, queryKey, id, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useTextMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(TextHost, { queryKey: ['Text'], id: 'event-id' });

    expect(useTextMock).toHaveBeenCalledWith(rxNostr, ['Text'], 'event-id', undefined);
  });

  it('renders the default slot with the text event once data is available', () => {
    const packet = fakeEventPacket({ kind: 1 });
    useTextMock.mockReturnValue(fakeReqResult(packet));

    render(TextHost, { queryKey: ['Text'], id: 'event-id' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      text: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useTextMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(TextHost, { queryKey: ['Text'], id: 'event-id' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useTextMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(TextHost, { queryKey: ['Text'], id: 'event-id' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    useTextMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(TextHost, { queryKey: ['Text'], id: 'event-id' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
