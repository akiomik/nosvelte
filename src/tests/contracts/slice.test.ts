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
import { getPublicKey, seckeySigner } from 'rx-nostr-crypto';
import * as svelte from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import {
  MissingProviderError,
  type NostrSigner,
  type ReqDescriptor,
  type ReqPlan
} from '$lib/v1/index.js';

import App from './slice/App.svelte';
import DiagHost from './slice/DiagHost.svelte';
import MetadataProbe from './slice/MetadataProbe.svelte';
import MutableRelays from './slice/MutableRelays.svelte';
import Poster from './slice/Poster.svelte';
import ReqHost from './slice/ReqHost.svelte';
import TwoProviders from './slice/TwoProviders.svelte';

// The suite's setup replaces Svelte's context with one shared map; the slice
// is about real context, so it has the real one.
vi.unmock('svelte');

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const OTHER_SECKEY = '0000000000000000000000000000000000000000000000000000000000000001';

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

const signerOf = (seckey: string): NostrSigner => seckeySigner(seckey) as unknown as NostrSigner;

/** A signed kind-0 event naming its author. */
const profileOf = async (
  signer: NostrSigner,
  name: string,
  createdAt: number,
  tags: string[][] = []
): Promise<Nostr.Event> =>
  (await signer.signEvent({
    kind: 0,
    content: JSON.stringify({ name }),
    tags,
    created_at: createdAt
  })) as Nostr.Event;

const text = (id: string): string | null => screen.getByTestId(id).textContent;

describe('the walking slice', () => {
  it('SL1: a consumer reads, posts, sees each relay answer, and leaves nothing open', async () => {
    browserLike();
    const urls = ['ws://localhost:9761', 'ws://localhost:9762'] as const;
    const relays = urls.map((url) => new WS(url, { jsonProtocol: true }));
    const signer = signerOf(SECKEY);
    // Two versions of the profile, the older one from the relay asked second.
    const profile = await profileOf(signer, 'alice', 1_700_000_000);
    const older = await profileOf(signer, 'bob', 1_600_000_000);

    const view = render(App, { relays: [...urls], signer, pubkey: profile.pubkey });

    // Each relay is asked once, answers, and ends the backlog; the newest is
    // shown. Kind 0 is replaceable, so the answer holds one revision per author
    // and it is the replacement that chooses here, not which entry `Metadata`
    // reads: with one author there is only ever one.
    for (const [index, relay] of relays.entries()) {
      const request = await nextOf(relay, 'REQ');
      relay.send(['EVENT', request[1], index === 0 ? profile : older]);
      relay.send(['EOSE', request[1]]);
    }
    await waitFor(() => expect(text('name')).toBe('alice'));

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

    // A new list on the provider reaches the requests already under it.
    const third = new WS('ws://localhost:9763', { jsonProtocol: true });
    await view.rerender({ relays: [urls[0], 'ws://localhost:9763'] });
    const request = await nextOf(third, 'REQ');
    expect(request[2]).toEqual({ kinds: [0], authors: [profile.pubkey], limit: 1 });
    third.send(['EOSE', request[1]]);

    // Going away closes what the provider opened.
    view.unmount();
    await waitFor(() => {
      for (const relay of [...relays, third]) expect(relay.server.clients()).toHaveLength(0);
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
    // Each provider has a signer of its own, so an event says whose it was.
    const leftSigner = signerOf(SECKEY);
    const rightSigner = signerOf(OTHER_SECKEY);
    const authors = [getPublicKey(SECKEY), getPublicKey(OTHER_SECKEY)];
    expect(authors[0]).not.toBe(authors[1]);
    render(TwoProviders, { left, right, leftSigner, rightSigner });

    // The right operation is called during initialisation, the left one from a
    // handler long after it was built; each sends through its own provider's
    // relays and signer, and nobody else's.
    await fireEvent.click(screen.getByTestId('post-left'));
    for (const [index, label] of ['left', 'right'].entries()) {
      const relay = relays[index] as WS;
      const event = (await nextOf(relay, 'EVENT'))[1] as Nostr.Event;
      expect(event.content).toBe(`from ${label}`);
      expect(event.pubkey).toBe(authors[index]);
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

  it('SL3: Metadata hands each outlet the request, the error by identity, and nodata by ruling 18', async () => {
    browserLike();
    const url = 'ws://localhost:9781';
    const relay = new WS(url, { jsonProtocol: true });
    const signer = signerOf(SECKEY);
    const pubkey = getPublicKey(SECKEY);

    // Loading is handed the request: its activity is readable there.
    const first = render(MetadataProbe, { relays: [url], pubkey });
    expect(text('loading')).toBe('refreshing');
    // A backlog that brings nothing is nodata, with no evidence of a match.
    let request = await nextOf(relay, 'REQ');
    relay.send(['EOSE', request[1]]);
    await waitFor(() => expect(text('nodata')).toBe('matched:false'));
    first.unmount();

    // A backlog whose only event has expired holds a match it cannot show: the
    // state says default, and a single-event component renders nodata.
    const expired = await profileOf(signer, 'gone', 1_700_000_000, [['expiration', '1']]);
    const second = render(MetadataProbe, { relays: [url], pubkey });
    request = await nextOf(relay, 'REQ');
    relay.send(['EVENT', request[1], expired]);
    relay.send(['EOSE', request[1]]);
    await waitFor(() => expect(text('nodata')).toBe('matched:true'));
    expect(screen.queryByTestId('name')).toBeNull();
    second.unmount();

    // A refused descriptor reaches the error outlet as the state's own object.
    render(MetadataProbe, { relays: [url], pubkey: 'not-a-pubkey' });
    await waitFor(() => expect(text('error')).toBe('same unsupported-filter'));
  });

  it('SL4: useReq hands each descriptor field to the engine and returns four members', async () => {
    browserLike();
    const url = 'ws://localhost:9791';
    const relay = new WS(url, { jsonProtocol: true });
    const filters = [{ kinds: [1], limit: 1 }];
    const host = (plan: () => ReqPlan) => render(ReqHost, { relays: [url], plan });

    // Each field, given a value the engine refuses, is refused by its own name:
    // a field the hook dropped would be defaulted instead, and one handed on
    // under another key would be refused by that key.
    const refused: [Partial<Record<keyof ReqDescriptor, unknown>>, string][] = [
      [{ filters: 'x' }, 'invalid-descriptor:filters'],
      [{ filters, live: 'yes' }, 'invalid-descriptor:live'],
      [{ filters, namespace: 42 }, 'invalid-descriptor:namespace'],
      [{ filters, settleTimeoutMs: -1 }, 'invalid-descriptor:settleTimeoutMs'],
      [{ filters, retain: 0 }, 'invalid-descriptor:retain'],
      [{ filters, relays: 'x' }, 'invalid-descriptor:relays'],
      // A list whose reads throw is refused, not thrown: below the guarded
      // reads, so under 0004's catch-all code rather than by the field.
      [
        {
          filters,
          relays: Object.assign(['ws://localhost:9791'], {
            [Symbol.iterator]: () => {
              throw new Error('unreadable iterator');
            }
          })
        },
        'descriptor-unreadable:'
      ],
      // A field whose read throws is the engine's to refuse, behind its own
      // guard, not the hook's to throw out of the component.
      [
        {
          filters,
          get live(): never {
            throw new Error('unreadable');
          }
        },
        'invalid-descriptor:live'
      ]
    ];
    for (const [descriptor, refusal] of refused) {
      const view = host(() => ({ kind: 'request', descriptor: descriptor as ReqDescriptor }));
      await waitFor(() => expect(text('refusal')).toBe(refusal));
      view.unmount();
    }

    // A deferred plan asks nothing, and says so when asked to refresh.
    const deferred = host(() => ({ kind: 'deferred' }));
    expect(text('status')).toBe('loading');
    expect(text('members')).toBe('activity,diagnostics,refresh,state');
    await fireEvent.click(screen.getByTestId('refresh'));
    await waitFor(() => expect(text('outcome')).toBe('not-started:deferred'));
    deferred.unmount();

    // A live request takes events after the backlog ends, and its wire id is
    // the library's: `nv-`, within the 64 characters a relay accepts.
    host(() => ({ kind: 'request', descriptor: { filters, live: true, retain: 10 } }));
    const request = await nextOf(relay, 'REQ');
    const id = request[1] as string;
    expect(id.startsWith('nv-')).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
    // The deferred plan before this one sent nothing.
    expect(relay.messages.filter((frame) => (frame as unknown[])[0] === 'REQ')).toHaveLength(1);
    relay.send(['EOSE', id]);
    const note = (await signerOf(SECKEY).signEvent({
      kind: 1,
      content: 'after the backlog',
      tags: [],
      created_at: Math.floor(Date.now() / 1000)
    })) as Nostr.Event;
    relay.send(['EVENT', id, note]);
    await waitFor(() => expect(text('count')).toBe('1'));
  });

  it('SL5: a refused relay list is one refusal until it says something else, and the children still mount', async () => {
    browserLike();
    const view = render(DiagHost, { relays: ['not a url'] });
    await waitFor(() => expect(text('code')).toBe('invalid-relay-input'));
    // Let the provider's own first application land before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(text('refusals')).toBe('1');

    // A parent re-rendering with an equal new array is the same refusal.
    await view.rerender({ relays: ['not a url'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(text('refusals')).toBe('1');
    // A list refused for another reason is a new one: the count can move.
    await view.rerender({ relays: ['still not a url'] });
    await waitFor(() => expect(text('refusals')).toBe('2'));
  });

  it('SL6: a change inside a $state relay list reaches the provider', async () => {
    browserLike();
    const first = 'ws://localhost:9801';
    const second = 'ws://localhost:9802';
    const relays = [new WS(first, { jsonProtocol: true }), new WS(second, { jsonProtocol: true })];
    render(MutableRelays, {
      first,
      second,
      plan: () => ({ kind: 'request', descriptor: { filters: [{ kinds: [1], limit: 1 }] } })
    });

    // Write-only at first, so nothing is asked; a flag flipped on the entry
    // makes it readable, and an entry pushed onto the list is asked too.
    await fireEvent.click(screen.getByTestId('read'));
    expect((await nextOf(relays[0] as WS, 'REQ'))[2]).toEqual({ kinds: [1], limit: 1 });
    await fireEvent.click(screen.getByTestId('push'));
    expect((await nextOf(relays[1] as WS, 'REQ'))[2]).toEqual({ kinds: [1], limit: 1 });
  });

  it('SL7: a relay list that cannot be read is refused by name, at construction and on a change', async () => {
    browserLike();
    const url = 'ws://localhost:9811';
    new WS(url, { jsonProtocol: true });
    const unreadable = (): [string, () => unknown][] => [
      [
        'an entry getter',
        () => {
          const list = [url];
          Object.defineProperty(list, 0, {
            get() {
              throw new Error('unreadable entry');
            }
          });
          return list;
        }
      ],
      [
        'an iterator',
        () => {
          const list = [url];
          list[Symbol.iterator] = () => {
            throw new Error('unreadable iterator');
          };
          return list;
        }
      ],
      [
        'a revoked proxy',
        () => {
          const { proxy, revoke } = Proxy.revocable([url], {});
          revoke();
          return proxy;
        }
      ]
    ];
    for (const [name, make] of unreadable()) {
      // At construction: the empty scope, the refusal published, children mounted.
      const constructed = render(DiagHost, { relays: make() as string[] });
      await waitFor(() => expect(text('code'), name).toBe('invalid-relay-input'));
      expect(text('scope'), name).toBe('');
      constructed.unmount();

      // On a change: the accepted scope is kept beside the refusal.
      const changed = render(DiagHost, { relays: [url] });
      await waitFor(() => expect(text('scope'), name).toBe(url));
      await changed.rerender({ relays: make() as string[] });
      await waitFor(() => expect(text('code'), name).toBe('invalid-relay-input'));
      expect(text('scope'), name).toBe(url);
      changed.unmount();
    }
  });
});
