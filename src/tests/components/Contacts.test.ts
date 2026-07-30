/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useContacts } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import ContactsHost from './fixtures/ContactsHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useContacts: vi.fn() };
});

const useContactsMock = vi.mocked(useContacts);

describe('Contacts', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useContactsMock.mockReset();
  });

  it('calls useContacts with the given rxNostr, queryKey, pubkey, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useContactsMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(ContactsHost, { queryKey: ['Contacts'], pubkey: 'pubkey-1' });

    expect(useContactsMock).toHaveBeenCalledWith(rxNostr, ['Contacts'], 'pubkey-1', undefined);
  });

  it('renders the default slot with the contacts event once data is available', () => {
    const packet = fakeEventPacket({ kind: 3 });
    useContactsMock.mockReturnValue(fakeReqResult(packet));

    render(ContactsHost, { queryKey: ['Contacts'], pubkey: 'pubkey-1' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      contacts: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useContactsMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(ContactsHost, { queryKey: ['Contacts'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useContactsMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(ContactsHost, { queryKey: ['Contacts'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    useContactsMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(ContactsHost, { queryKey: ['Contacts'], pubkey: 'pubkey-1' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
