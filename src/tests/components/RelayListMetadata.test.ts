/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useRelayListMetadata } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import RelayListMetadataHost from './fixtures/RelayListMetadataHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useRelayListMetadata: vi.fn() };
});

const useRelayListMetadataMock = vi.mocked(useRelayListMetadata);

describe('RelayListMetadata', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useRelayListMetadataMock.mockReset();
  });

  it('calls useRelayListMetadata with the given rxNostr, queryKey, pubkey, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useRelayListMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(RelayListMetadataHost, { queryKey: ['RelayListMetadata'], pubkey: 'pubkey-1' });

    expect(useRelayListMetadataMock).toHaveBeenCalledWith(
      rxNostr,
      ['RelayListMetadata'],
      'pubkey-1',
      undefined
    );
  });

  it('renders the default slot with the relay list metadata event once data is available', () => {
    const packet = fakeEventPacket({ kind: 10002 });
    useRelayListMetadataMock.mockReturnValue(fakeReqResult(packet));

    render(RelayListMetadataHost, { queryKey: ['RelayListMetadata'], pubkey: 'pubkey-1' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      relayListMetadata: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useRelayListMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(RelayListMetadataHost, { queryKey: ['RelayListMetadata'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useRelayListMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(RelayListMetadataHost, { queryKey: ['RelayListMetadata'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    useRelayListMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(RelayListMetadataHost, { queryKey: ['RelayListMetadata'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
