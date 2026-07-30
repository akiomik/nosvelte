/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useUniqueEventList } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import UniqueEventListHost from './fixtures/UniqueEventListHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useUniqueEventList: vi.fn() };
});

const useUniqueEventListMock = vi.mocked(useUniqueEventList);

describe('UniqueEventList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useUniqueEventListMock.mockReset();
  });

  it('calls useUniqueEventList with the given rxNostr, queryKey, filters, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useUniqueEventListMock.mockReturnValue(fakeReqResult([], 'loading'));
    const filters = [{ kinds: [1] }];

    render(UniqueEventListHost, { queryKey: ['UniqueEventList'], filters });

    expect(useUniqueEventListMock).toHaveBeenCalledWith(
      rxNostr,
      ['UniqueEventList'],
      filters,
      undefined
    );
  });

  it('renders the default slot with events once data is available', () => {
    const packet = fakeEventPacket();
    useUniqueEventListMock.mockReturnValue(fakeReqResult([packet]));

    render(UniqueEventListHost, { queryKey: ['UniqueEventList'], filters: [{ kinds: [1] }] });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      events: [packet.event],
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useUniqueEventListMock.mockReturnValue(fakeReqResult([], 'loading'));

    render(UniqueEventListHost, { queryKey: ['UniqueEventList'], filters: [{ kinds: [1] }] });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useUniqueEventListMock.mockReturnValue(fakeReqResult([], 'error', error));

    render(UniqueEventListHost, { queryKey: ['UniqueEventList'], filters: [{ kinds: [1] }] });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with an empty list', () => {
    useUniqueEventListMock.mockReturnValue(fakeReqResult([], 'success'));

    render(UniqueEventListHost, { queryKey: ['UniqueEventList'], filters: [{ kinds: [1] }] });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
