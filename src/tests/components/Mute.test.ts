/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useMute } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import MuteHost from './fixtures/MuteHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useMute: vi.fn() };
});

const useMuteMock = vi.mocked(useMute);

describe('Mute', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useMuteMock.mockReset();
  });

  it('calls useMute with the given rxNostr, queryKey, pubkey, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useMuteMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(MuteHost, { queryKey: ['Mute'], pubkey: 'pubkey-1' });

    expect(useMuteMock).toHaveBeenCalledWith(rxNostr, ['Mute'], 'pubkey-1', undefined);
  });

  it('renders the default slot with the mute event once data is available', () => {
    const packet = fakeEventPacket({ kind: 10000 });
    useMuteMock.mockReturnValue(fakeReqResult(packet));

    render(MuteHost, { queryKey: ['Mute'], pubkey: 'pubkey-1' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      mute: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useMuteMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(MuteHost, { queryKey: ['Mute'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useMuteMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(MuteHost, { queryKey: ['Mute'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    useMuteMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(MuteHost, { queryKey: ['Mute'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
