/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useMetadata } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import MetadataHost from './fixtures/MetadataHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useMetadata: vi.fn() };
});

const useMetadataMock = vi.mocked(useMetadata);

describe('Metadata', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useMetadataMock.mockReset();
  });

  it('calls useMetadata with the given rxNostr, queryKey, pubkey, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(MetadataHost, { queryKey: ['Metadata'], pubkey: 'pubkey-1' });

    expect(useMetadataMock).toHaveBeenCalledWith(rxNostr, ['Metadata'], 'pubkey-1', undefined);
  });

  it('renders the default slot with the metadata event once data is available', () => {
    const packet = fakeEventPacket({ kind: 0 });
    useMetadataMock.mockReturnValue(fakeReqResult(packet));

    render(MetadataHost, { queryKey: ['Metadata'], pubkey: 'pubkey-1' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      metadata: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(MetadataHost, { queryKey: ['Metadata'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(MetadataHost, { queryKey: ['Metadata'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    useMetadataMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(MetadataHost, { queryKey: ['Metadata'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
