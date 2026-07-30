/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, usePin } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import PinHost from './fixtures/PinHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, usePin: vi.fn() };
});

const usePinMock = vi.mocked(usePin);

describe('Pin', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    usePinMock.mockReset();
  });

  it('calls usePin with the given rxNostr, queryKey, pubkey, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    usePinMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(PinHost, { queryKey: ['Pin'], pubkey: 'pubkey-1' });

    expect(usePinMock).toHaveBeenCalledWith(rxNostr, ['Pin'], 'pubkey-1', undefined);
  });

  it('renders the default slot with the pin event once data is available', () => {
    const packet = fakeEventPacket({ kind: 10001 });
    usePinMock.mockReturnValue(fakeReqResult(packet));

    render(PinHost, { queryKey: ['Pin'], pubkey: 'pubkey-1' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      pin: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    usePinMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(PinHost, { queryKey: ['Pin'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    usePinMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(PinHost, { queryKey: ['Pin'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    usePinMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(PinHost, { queryKey: ['Pin'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
