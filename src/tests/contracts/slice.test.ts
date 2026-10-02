/**
 * The walking slice (0005's phase-2 order, step 3): one consumer, written
 * against the v1 entry, that mounts the provider, reads through a request
 * component, posts through `useSend`, shows each relay's answer, and goes
 * away — over relays that speak the wire, with the provider's real verifier,
 * transport and Svelte context.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { seckeySigner } from 'rx-nostr-crypto';
import * as svelte from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { MissingProviderError, type NostrSigner } from '$lib/v1/index.js';

import App from './slice/App.svelte';
import Poster from './slice/Poster.svelte';
import TwoProviders from './slice/TwoProviders.svelte';

// The suite's setup replaces Svelte's context with one shared map; the slice
// is about real context, so it has the real one.
vi.unmock('svelte');

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

/** The next frame of one type a relay receives; the closings of finished reads come in between. */
const nextOf = async (relay: WS, type: string): Promise<unknown[]> => {
  for (;;) {
    const frame = (await relay.nextMessage) as unknown[];
    if (frame[0] === type) return frame;
  }
};

/** The environment a browser gives the provider: a socket constructor, and no NIP-11 to fetch. */
const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

describe('the walking slice', () => {
  it('SL1: a consumer reads, posts, sees each relay answer, and leaves nothing open', async () => {
    browserLike();
    const urls = ['ws://localhost:9761', 'ws://localhost:9762'] as const;
    const relays = urls.map((url) => new WS(url, { jsonProtocol: true }));
    const signer = seckeySigner(SECKEY) as unknown as NostrSigner;
    const profile = (await signer.signEvent({
      kind: 0,
      content: JSON.stringify({ name: 'alice' }),
      tags: [],
      created_at: 1_700_000_000
    })) as Nostr.Event;

    const view = render(App, { relays: [...urls], signer, pubkey: profile.pubkey });

    // Each relay is asked once, answers with the profile, and ends the backlog.
    for (const relay of relays) {
      const request = await nextOf(relay, 'REQ');
      relay.send(['EVENT', request[1], profile]);
      relay.send(['EOSE', request[1]]);
    }
    expect((await screen.findByTestId('name')).textContent).toBe('alice');

    // Posting reaches both relays, and each answer comes back as its own.
    await fireEvent.click(screen.getByTestId('post'));
    const sent: Nostr.Event[] = [];
    for (const relay of relays) {
      sent.push((await nextOf(relay, 'EVENT'))[1] as Nostr.Event);
    }
    expect(sent[0]?.id).toBe(sent[1]?.id);
    expect(sent[0]?.content).toBe('hello from the slice');
    expect(sent[0]?.pubkey).toBe(profile.pubkey);
    relays[0]?.send(['OK', sent[0]?.id, true, '']);
    relays[1]?.send(['OK', sent[0]?.id, false, 'blocked: not here']);
    const outcomes = (await screen.findAllByTestId('outcome')).map((item) => item.textContent);
    // Named in the consumer's own spelling, as configured.
    expect(outcomes.sort()).toEqual([`${urls[0]} accepted`, `${urls[1]} rejected`].sort());

    // Going away closes what the provider opened.
    view.unmount();
    await waitFor(() => {
      for (const relay of relays) expect(relay.server.clients()).toHaveLength(0);
    });
  });

  // @contracts C6-C17
  it('SL2: a send is bound to the provider it was built under, and needs one', async () => {
    browserLike();
    // The real context, not the suite's shared map: the row is about it.
    expect(vi.isMockFunction(svelte.getContext)).toBe(false);
    const left = 'ws://localhost:9771';
    const right = 'ws://localhost:9772';
    const relays = [new WS(left, { jsonProtocol: true }), new WS(right, { jsonProtocol: true })];
    const signer = seckeySigner(SECKEY) as unknown as NostrSigner;
    render(TwoProviders, { left, right, signer });

    // Each operation, called from a handler long after it was built, sends
    // through its own provider's relays and nobody else's.
    for (const [index, label] of ['left', 'right'].entries()) {
      await fireEvent.click(screen.getByTestId(`post-${label}`));
      const relay = relays[index] as WS;
      const event = (await nextOf(relay, 'EVENT'))[1] as Nostr.Event;
      expect(event.content).toBe(`from ${label}`);
      relay.send(['OK', event.id, true, '']);
      expect((await screen.findByTestId(`outcome-${label}`)).textContent).toBe(
        `${label === 'left' ? left : right} accepted`
      );
    }
    // The other relay saw no post in either case.
    for (const relay of relays)
      expect(relay.messages.filter((frame) => (frame as unknown[])[0] === 'EVENT')).toHaveLength(1);

    // With no provider above it, building the operation is refused.
    expect(() => render(Poster, { label: 'alone' })).toThrow(MissingProviderError);
  });
});
