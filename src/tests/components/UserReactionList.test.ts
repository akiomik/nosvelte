/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useUserReactionList } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import UserReactionListHost from './fixtures/UserReactionListHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useUserReactionList: vi.fn() };
});

const useUserReactionListMock = vi.mocked(useUserReactionList);

describe('UserReactionList', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useUserReactionListMock.mockReset();
  });

  it('calls useUserReactionList with the given rxNostr, queryKey, pubkey, limit, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useUserReactionListMock.mockReturnValue(fakeReqResult([], 'loading'));

    render(UserReactionListHost, {
      queryKey: ['UserReactionList'],
      pubkey: 'pubkey-1',
      limit: 42
    });

    expect(useUserReactionListMock).toHaveBeenCalledWith(
      rxNostr,
      ['UserReactionList'],
      'pubkey-1',
      42,
      undefined
    );
  });

  it('defaults limit to 100', () => {
    useUserReactionListMock.mockReturnValue(fakeReqResult([], 'loading'));

    render(UserReactionListHost, { queryKey: ['UserReactionList'], pubkey: 'pubkey-1' });

    expect(useUserReactionListMock).toHaveBeenCalledWith(
      expect.anything(),
      ['UserReactionList'],
      'pubkey-1',
      100,
      undefined
    );
  });

  it('renders the default slot with reactions once data is available', () => {
    const packet = fakeEventPacket({ kind: 7 });
    useUserReactionListMock.mockReturnValue(fakeReqResult([packet]));

    render(UserReactionListHost, { queryKey: ['UserReactionList'], pubkey: 'pubkey-1' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      reactions: [packet.event],
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useUserReactionListMock.mockReturnValue(fakeReqResult([], 'loading'));

    render(UserReactionListHost, { queryKey: ['UserReactionList'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useUserReactionListMock.mockReturnValue(fakeReqResult([], 'error', error));

    render(UserReactionListHost, { queryKey: ['UserReactionList'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with an empty list', () => {
    useUserReactionListMock.mockReturnValue(fakeReqResult([], 'success'));

    render(UserReactionListHost, { queryKey: ['UserReactionList'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
