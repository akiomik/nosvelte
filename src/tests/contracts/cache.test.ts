/**
 * Cache identity through the published hook (0003 B1, B2, B9): `useReq` under
 * a mounted `NostrApp`, over a relay that speaks the wire. Whether two requests
 * share an entry is read from what a consumer can see — how many REQs the relay
 * receives for them, and whether an answer to one reaches the other — never
 * from the provider's cache. The key itself is witnessed against its own seam
 * in `engine/identity.test.ts`.
 */
import { render, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getPublicKey, seckeySigner } from 'rx-nostr-crypto';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrSigner, ReqDescriptor, ReqHandle, ReqPlan } from '$lib/v1/index.js';

import Host from './descriptor/Host.svelte';

vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const AUTHOR = getPublicKey(SECKEY);
const signer = seckeySigner(SECKEY) as unknown as NostrSigner;

const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

const requestsTo = (relay: WS): unknown[][] =>
  (relay.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');

let port = 9971;

/** Requests mounted together under one provider, and the handles they return. */
const mountAll = (
  descriptors: unknown[]
): { relay: WS; handles: (ReqHandle | undefined)[]; unmount: () => void } => {
  const url = `ws://localhost:${port++}`;
  const relay = new WS(url, { jsonProtocol: true });
  const handles: (ReqHandle | undefined)[] = [];
  const view = render(Host, {
    relays: [url],
    plans: descriptors.map((descriptor) => (): ReqPlan => ({
      kind: 'request',
      descriptor: descriptor as ReqDescriptor
    })),
    seen: (index: number, handed: ReqHandle) => (handles[index] = handed)
  });
  return { relay, handles, unmount: () => view.unmount() };
};

/** Wait until the relay has received `count` REQs, then a little longer for more. */
const settledCount = async (relay: WS, count: number): Promise<number> => {
  await waitFor(() => expect(requestsTo(relay).length).toBeGreaterThanOrEqual(count));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return requestsTo(relay).length;
};

describe('cache identity, through the published hook', () => {
  // @contracts B1-C2
  it('CK1: one descriptor spelled two ways is one entry and one REQ', async () => {
    browserLike();
    // A reordered OR array, and an author written twice.
    const spelled = [
      { filters: [{ kinds: [1], authors: [AUTHOR, AUTHOR] }, { kinds: [7] }] },
      { filters: [{ kinds: [7] }, { kinds: [1], authors: [AUTHOR] }] }
    ];
    const both = mountAll(spelled);
    expect(await settledCount(both.relay, 1)).toBe(1);
    // The one answer is both requests' answer.
    const [, subscription] = requestsTo(both.relay)[0] as [string, string];
    both.relay.send(['EOSE', subscription]);
    await waitFor(() => {
      for (const handle of both.handles) expect(handle?.state.status).toBe('settled');
    });
    both.unmount();

    // The control: the same two beside a third whose filters differ, so the
    // count can move — the third is asked on its own.
    const three = mountAll([...spelled, { filters: [{ kinds: [7] }, { kinds: [2] }] }]);
    expect(await settledCount(three.relay, 2)).toBe(2);
    three.unmount();

    // And there is no key a caller could write to merge or split them: the
    // descriptor's fields are these six, and none of them is a key.
    expectTypeOf<keyof ReqDescriptor>().toEqualTypeOf<
      'filters' | 'live' | 'namespace' | 'settleTimeoutMs' | 'retain' | 'relays'
    >();
  });

  // @contracts B2-C2
  it('CK2: requests differing in filters, or in namespace alone, do not share an answer', async () => {
    browserLike();
    const event = (await signer.signEvent({
      kind: 1,
      content: 'one answer',
      tags: [],
      created_at: Math.floor(Date.now() / 1000)
    })) as Nostr.Event;
    // Each pair could share the event: it matches both members of both pairs.
    for (const [label, pair] of [
      [
        'filters',
        [{ filters: [{ kinds: [1] }] }, { filters: [{ kinds: [1], authors: [AUTHOR] }] }]
      ],
      [
        'namespace',
        [
          { filters: [{ kinds: [1] }], namespace: 'left' },
          { filters: [{ kinds: [1] }], namespace: 'right' }
        ]
      ]
    ] as const) {
      // Both directions: each request's REQ is the one answered, in turn, so
      // an answer leaking into a request mounted before it and one leaking into
      // a request mounted after it are both seen.
      for (const answered of [0, 1]) {
        const where = `${label}, answering REQ ${answered}`;
        const mounted = mountAll([...pair]);
        expect(await settledCount(mounted.relay, 2), where).toBe(2);
        const [, subscription] = requestsTo(mounted.relay)[answered] as [string, string];
        mounted.relay.send(['EVENT', subscription, event]);
        mounted.relay.send(['EOSE', subscription]);
        await waitFor(() =>
          expect(
            mounted.handles.some((handle) => handle?.state.status === 'settled'),
            where
          ).toBe(true)
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        const statuses = mounted.handles.map((handle) => handle?.state.status).sort();
        expect(statuses, where).toEqual(['loading', 'settled']);
        const settled = mounted.handles.find((handle) => handle?.state.status === 'settled');
        expect(
          settled?.state.status === 'settled' && settled.state.events.map((shown) => shown.id),
          where
        ).toEqual([event.id]);
        mounted.unmount();
      }
    }
    // The type has no caller key to merge them with either.
    expectTypeOf<ReqDescriptor>().not.toHaveProperty('queryKey');
  });

  // @contracts B9-C2
  it('CK3: a short settle timeout ends its own backlog and not a longer one beside it', async () => {
    browserLike();
    // Neither is answered: the relay sends nothing at all.
    const mounted = mountAll([
      { filters: [{ kinds: [1] }], settleTimeoutMs: 200 },
      { filters: [{ kinds: [1] }], settleTimeoutMs: 10_000 }
    ]);
    expect(await settledCount(mounted.relay, 2)).toBe(2);
    const [short, long] = mounted.handles;
    await waitFor(() => expect(short?.state.status).toBe('incomplete'));
    expect(short?.state.status === 'incomplete' && short.state.causes).toEqual(['timeout']);
    // The longer one is still waiting on its own timer — then, and well after
    // the shorter one's timer would have fired again, so a timer shared or
    // derived from the shorter one is seen.
    expect(long?.state.status).toBe('loading');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(long?.state.status).toBe('loading');
    expect(long?.activity).toBe('refreshing');
    mounted.unmount();
  });
});
