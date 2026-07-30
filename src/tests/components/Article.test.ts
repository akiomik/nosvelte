/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { render, screen } from '@testing-library/svelte';
import type { EventPacket, RxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app, useArticle } from '$lib/stores/index.js';

import { fakeReqResult } from '../helpers/component.js';
import { fakeEventPacket } from '../helpers/relay.js';
import ArticleHost from './fixtures/ArticleHost.svelte';

vi.mock('$lib/stores/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/stores/index.js')>('$lib/stores/index.js');
  return { ...actual, useArticle: vi.fn() };
});

const useArticleMock = vi.mocked(useArticle);

describe('Article', () => {
  beforeEach(() => {
    setQueryClientContext(new QueryClient());
    app.set({ rxNostr: {} as RxNostr });
    useArticleMock.mockReset();
  });

  it('calls useArticle with the given rxNostr, queryKey, pubkey, identifier, and req', () => {
    const rxNostr = { id: 'the-rxNostr' } as unknown as RxNostr;
    app.set({ rxNostr });
    useArticleMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(ArticleHost, { queryKey: ['Article'], pubkey: 'pubkey-1', identifier: 'my-article' });

    expect(useArticleMock).toHaveBeenCalledWith(
      rxNostr,
      ['Article'],
      'pubkey-1',
      'my-article',
      undefined
    );
  });

  it('renders the default slot with the article event once data is available', () => {
    const packet = fakeEventPacket({ kind: 30023 });
    useArticleMock.mockReturnValue(fakeReqResult(packet));

    render(ArticleHost, { queryKey: ['Article'], pubkey: 'pubkey-1', identifier: 'my-article' });

    expect(JSON.parse(screen.getByTestId('default').textContent ?? '')).toEqual({
      article: packet.event,
      status: 'success'
    });
  });

  it('renders the loading slot while the query is pending', () => {
    useArticleMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'loading'));

    render(ArticleHost, { queryKey: ['Article'], pubkey: 'pubkey-1', identifier: 'my-article' });

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('renders the error slot when the query fails', () => {
    const error = new Error('boom');
    useArticleMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'error', error));

    render(ArticleHost, { queryKey: ['Article'], pubkey: 'pubkey-1', identifier: 'my-article' });

    expect(screen.getByTestId('error')).toHaveTextContent('boom');
  });

  it('renders the nodata slot when the query succeeds with no event', () => {
    useArticleMock.mockReturnValue(fakeReqResult<EventPacket>(undefined, 'success'));

    render(ArticleHost, { queryKey: ['Article'], pubkey: 'pubkey-1', identifier: 'my-article' });

    expect(screen.getByTestId('nodata')).toHaveTextContent('nodata');
  });
});
