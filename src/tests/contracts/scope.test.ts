/**
 * The relay scope through the published provider (0003 B3, B-α): `useReq`
 * under a mounted `NostrApp` whose `relays` prop changes, over relays that
 * speak the wire. What a change does to a request is read from what a consumer
 * can see — the frames each relay receives and the handle's state. The scope's
 * identity and the request's key are witnessed against their own seam in
 * `engine/scope.test.ts` and `engine/relaytarget.test.ts`.
 */
import { render, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { seckeySigner } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrSigner, ReqHandle, ReqPlan, useRelayDiagnostics } from '$lib/v1/index.js';

import Host from './descriptor/Host.svelte';

vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const signer = seckeySigner(
  '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a'
) as unknown as NostrSigner;

const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

const requestsTo = (relay: WS): unknown[][] =>
  (relay.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');

let port = 9991;
const freshRelay = (): { url: string; relay: WS } => {
  const url = `ws://localhost:${port++}`;
  return { url, relay: new WS(url, { jsonProtocol: true }) };
};

const PLAN = (): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [1] }] } });

/** Answer the latest REQ a relay received with `events`, then end its backlog. */
const answer = (relay: WS, events: Nostr.Event[]): void => {
  const [, subscription] = requestsTo(relay).at(-1) as [string, string];
  for (const event of events) relay.send(['EVENT', subscription, event]);
  relay.send(['EOSE', subscription]);
};

describe('the relay scope, through the published provider', () => {
  // @contracts B3-C3
  it('RS1: a request whose scope widens is asked again, not answered from the narrower scope', async () => {
    browserLike();
    const a = freshRelay();
    const b = freshRelay();
    const event = (await signer.signEvent({
      kind: 1,
      content: 'from the narrower scope',
      tags: [],
      created_at: Math.floor(Date.now() / 1000)
    })) as Nostr.Event;
    let request: ReqHandle | undefined;
    const view = render(Host, {
      relays: [a.url],
      plans: [PLAN],
      seen: (_index: number, handed: ReqHandle) => (request = handed)
    });
    await waitFor(() => expect(requestsTo(a.relay)).toHaveLength(1));
    answer(a.relay, [event]);
    await waitFor(() => expect(request?.state.status).toBe('settled'));

    // Widened: the request is a new question, so it is asked — of the relay it
    // already had and of the one that joined — and what the narrower scope
    // brought in is not its answer meanwhile.
    await view.rerender({ relays: [a.url, b.url] });
    await waitFor(() => expect(requestsTo(b.relay)).toHaveLength(1));
    expect(requestsTo(a.relay)).toHaveLength(2);
    expect(request?.state.status).toBe('loading');

    // And the narrower answer is still where it was: narrowed back, the
    // request reads it at once.
    await view.rerender({ relays: [a.url] });
    await waitFor(() => expect(request?.state.status).toBe('settled'));
    expect(
      request?.state.status === 'settled' && request.state.events.map((shown) => shown.id)
    ).toEqual([event.id]);
    view.unmount();
  });

  // @contracts B-α-C6
  it('RS2: a relay list changed to the same readable set churns nothing', async () => {
    browserLike();
    const a = freshRelay();
    const b = freshRelay();
    let request: ReqHandle | undefined;
    let diagnostics: ReturnType<typeof useRelayDiagnostics> | undefined;
    const view = render(Host, {
      relays: [a.url, b.url],
      plans: [PLAN],
      seen: (_index: number, handed: ReqHandle) => (request = handed),
      diagnostics: (held: ReturnType<typeof useRelayDiagnostics>) => (diagnostics = held)
    });
    await waitFor(() => {
      expect(requestsTo(a.relay)).toHaveLength(1);
      expect(requestsTo(b.relay)).toHaveLength(1);
    });
    answer(a.relay, []);
    answer(b.relay, []);
    await waitFor(() => expect(request?.state.status).toBe('settled'));

    /**
     * Nothing asked and nothing re-answered, read after a quiet window: a
     * churn later than 300 ms after the change is not seen here.
     */
    const expectQuiet = async (label: string): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(requestsTo(a.relay), label).toHaveLength(1);
      expect(requestsTo(b.relay), label).toHaveLength(1);
      expect(request?.state.status, label).toBe('settled');
    };

    // Reordered and repeated: the same readable set, written the same way, so
    // the scope is not rebuilt — the diagnostics a consumer holds are the same
    // object — and nothing is asked.
    for (const same of [
      [b.url, a.url],
      [a.url, b.url, a.url]
    ]) {
      const held = diagnostics?.relays;
      await view.rerender({ relays: same });
      await expectQuiet(JSON.stringify(same));
      expect(diagnostics?.relays, `${JSON.stringify(same)}: rebuilt`).toBe(held);
    }

    // Respelled with a trailing slash: the same readable set, written another
    // way. The requests are not churned, and the diagnostics move — they
    // publish the spellings the consumer configured, which changed.
    await view.rerender({ relays: [`${a.url}/`, `${b.url}/`] });
    await expectQuiet('respelled');
    expect(
      Object.values(diagnostics?.relays ?? {})
        .flatMap((relay) => relay?.configuredUrls ?? [])
        .sort()
    ).toEqual([`${a.url}/`, `${b.url}/`]);

    // The control: a set that is not the same is asked again.
    const c = freshRelay();
    await view.rerender({ relays: [a.url, b.url, c.url] });
    await waitFor(() => expect(requestsTo(c.relay)).toHaveLength(1));
    view.unmount();
  });
});
