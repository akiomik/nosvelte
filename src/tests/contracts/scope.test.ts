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

import type {
  NostrSigner,
  ReqHandle,
  ReqPlan,
  Send,
  SendResult,
  useRelayDiagnostics
} from '$lib/v1/index.js';

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

  // @contracts B-α-C2
  it('RS3: a request with nowhere to ask runs when the provider is given its first relay', async () => {
    browserLike();
    const a = freshRelay();
    let request: ReqHandle | undefined;
    // A hook that brought no inputs: the provider owns every one of them.
    const view = render(Host, {
      relays: [],
      plans: [PLAN],
      seen: (_index: number, handed: ReqHandle) => (request = handed)
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The control: with no relay there is nowhere to ask, and the request says
    // so rather than failing.
    expect(request?.state.status, 'nowhere to ask yet').toBe('loading');

    // The provider's own relay list moves, through the prop a consumer sets.
    await view.rerender({ relays: [a.url] });
    await waitFor(() => expect(requestsTo(a.relay), 'the change starts it').toHaveLength(1));
    answer(a.relay, []);
    await waitFor(() => expect(request?.state.status).toBe('settled'));
    view.unmount();
  });

  // @contracts B-α-C11
  it('RS4: an EOSE settles a backlog only from the relay that was asked, under this backlog’s id', async () => {
    browserLike();
    // Written the way the transport does not spell it, and settled by it in
    // one pass: the escape is decoded, so the socket is opened under `~`.
    const host = `ws://localhost:${port++}`;
    const written = `${host}/?x=%7E`;
    const relay = new WS(`${host}/?x=~`, { jsonProtocol: true });
    // A second relay in the same scope, so that an EOSE settling "the backlog"
    // rather than "this relay's part of it" has something to be wrong about.
    const b = freshRelay();
    const idsOn = (server: WS, filterKind: number): string[] =>
      requestsTo(server)
        .filter((frame) => (frame[2] as { kinds?: number[] }).kinds?.[0] === filterKind)
        .map((frame) => String(frame[1]));
    const ids = (filterKind: number): string[] => idsOn(relay, filterKind);
    const backwardOn = (server: WS): string =>
      idsOn(server, 1)
        .filter((id) => id.includes('-b:'))
        .at(-1) as string;
    const handles: ReqHandle[] = [];
    const view = render(Host, {
      relays: [written, b.url],
      plans: [
        // This request, live, so it has a forward leg as well as a backlog.
        (): ReqPlan => ({
          kind: 'request',
          descriptor: {
            filters: [{ kinds: [1] }],
            live: true,
            retain: 'unbounded',
            settleTimeoutMs: 1000
          }
        }),
        // Another request on the same client.
        (): ReqPlan => ({
          kind: 'request',
          descriptor: { filters: [{ kinds: [2] }], settleTimeoutMs: 1000 }
        }),
        // A request that names the relay itself, in the caller's spelling: the
        // other boundary a target set is minted at.
        (): ReqPlan => ({
          kind: 'request',
          descriptor: { filters: [{ kinds: [3] }], relays: [written], settleTimeoutMs: 1000 }
        })
      ],
      seen: (index: number, handed: ReqHandle) => (handles[index] = handed)
    });
    await waitFor(() => {
      expect(ids(1).some((id) => id.includes('-b:'))).toBe(true);
      expect(ids(1).some((id) => id.includes('-f:'))).toBe(true);
      expect(ids(2)).toHaveLength(1);
      expect(idsOn(b.relay, 1).some((id) => id.includes('-b:'))).toBe(true);
    });
    const mine = handles[0] as ReqHandle;
    const forward = ids(1).find((id) => id.includes('-f:')) as string;
    const other = ids(2)[0] as string;

    // Somebody else's EOSE, and this request's own forward one, on the
    // escaped relay — with the other relay's part answered properly, so the
    // escaped relay is the only one left undecided. Read while the backlog is
    // still waiting, so a timeout that had already fired cannot pass this.
    expect(mine.state.status, 'still waiting when the foreign EOSEs arrive').toBe('loading');
    b.relay.send(['EOSE', backwardOn(b.relay)]);
    relay.send(['EOSE', other]);
    relay.send(['EOSE', forward]);
    await waitFor(() => expect(mine.state.status).toBe('incomplete'), { timeout: 3000 });
    expect(
      mine.state.status === 'incomplete' && mine.state.error.incompleteCauses,
      'their EOSE is not this backlog ending'
    ).toEqual(['timeout']);

    // Asked again, and answered under its own backward id by one relay alone —
    // twice, so an EOSE credited to whichever relay is still waiting rather
    // than to the one that sent it would finish the backlog. Each relay in
    // turn, so the order the targets are held in decides nothing.
    for (const [speaking, label] of [
      [relay, 'the escaped relay'],
      [b.relay, 'the other relay']
    ] as const) {
      const before = idsOn(speaking, 1).filter((id) => id.includes('-b:')).length;
      const partly = mine.refresh();
      await waitFor(() =>
        expect(idsOn(speaking, 1).filter((id) => id.includes('-b:')).length).toBeGreaterThan(before)
      );
      speaking.send(['EOSE', backwardOn(speaking)]);
      speaking.send(['EOSE', backwardOn(speaking)]);
      expect(await partly, `${label} twice is not every relay’s EOSE`).toEqual({
        kind: 'incomplete',
        causes: ['timeout']
      });
    }

    // Both relays answer under this backlog's own id: exactly complete.
    const backwardsOn = (server: WS): number =>
      idsOn(server, 1).filter((id) => id.includes('-b:')).length;
    const asked = { escaped: backwardsOn(relay), other: backwardsOn(b.relay) };
    const again = mine.refresh();
    await waitFor(() => {
      expect(backwardsOn(relay)).toBeGreaterThan(asked.escaped);
      expect(backwardsOn(b.relay)).toBeGreaterThan(asked.other);
    });
    relay.send(['EOSE', backwardOn(relay)]);
    b.relay.send(['EOSE', backwardOn(b.relay)]);
    expect(await again).toEqual({ kind: 'complete' });

    // The control: the same wiring, both relays saying nothing, is a timeout —
    // so `complete` above was the EOSEs attributed, not an answer given anyway.
    const silent = mine.refresh();
    expect(await silent).toEqual({ kind: 'incomplete', causes: ['timeout'] });

    // The relay named by the request rather than by the scope is attributed
    // the same way: its own backward id ends its backlog, complete.
    await waitFor(() => expect(ids(3)).toHaveLength(1));
    const named = handles[2] as ReqHandle;
    const namedAsked = ids(3).length;
    const namedAgain = named.refresh();
    await waitFor(() => expect(ids(3).length).toBeGreaterThan(namedAsked));
    relay.send(['EOSE', ids(3).at(-1) as string]);
    expect(await namedAgain).toEqual({ kind: 'complete' });
    view.unmount();
  }, 20_000);

  // @contracts B-α-C12
  it('RS5: a NOTICE and a CLOSED are recorded against a relay configured in a spelling the transport rewrites', async () => {
    browserLike();
    const a = freshRelay();
    let diagnostics: ReturnType<typeof useRelayDiagnostics> | undefined;
    // A doubled trailing slash, which the transport settles in one pass: the
    // socket is the one `a.url` names, and only the name this library gives
    // the relay can differ.
    // A second relay beside it, which must be credited with none of it.
    const b = freshRelay();
    const view = render(Host, {
      relays: [`${a.url}//`, b.url],
      plans: [PLAN],
      seen: () => {},
      diagnostics: (held: ReturnType<typeof useRelayDiagnostics>) => (diagnostics = held)
    });
    await waitFor(() => expect(requestsTo(a.relay)).toHaveLength(1));
    expect(
      Object.keys(diagnostics?.relays ?? {}).sort(),
      'named as the transport names it'
    ).toEqual([a.url, b.url].sort());
    // Each relay speaks in turn, in its own words: what is recorded against a
    // relay is what that relay said, whichever of them is held first.
    const said = (relay: string): unknown => diagnostics?.relays[relay]?.lastNotice;
    const refused = (relay: string): unknown => diagnostics?.relays[relay]?.lastRefusal?.notice;
    a.relay.send(['NOTICE', 'rate-limited: slow down']);
    await waitFor(() =>
      expect(said(a.url)).toEqual({ text: 'rate-limited: slow down', truncated: false })
    );
    expect(said(b.url), 'not against its neighbour').toBeUndefined();
    b.relay.send(['NOTICE', 'from the neighbour']);
    await waitFor(() =>
      expect(said(b.url)).toEqual({ text: 'from the neighbour', truncated: false })
    );
    expect(said(a.url), 'and not over the first').toEqual({
      text: 'rate-limited: slow down',
      truncated: false
    });

    // And the other diagnostic this library keys by relay: a `CLOSED`.
    const [, onA] = requestsTo(a.relay)[0] as [string, string];
    a.relay.send(['CLOSED', onA, 'auth-required: sign in first']);
    await waitFor(() =>
      expect(refused(a.url)).toEqual({ text: 'auth-required: sign in first', truncated: false })
    );
    expect(refused(b.url), 'not against its neighbour').toBeUndefined();
    const [, onB] = requestsTo(b.relay)[0] as [string, string];
    b.relay.send(['CLOSED', onB, 'error: the neighbour closed it']);
    await waitFor(() =>
      expect(refused(b.url)).toEqual({ text: 'error: the neighbour closed it', truncated: false })
    );
    expect(refused(a.url), 'and not over the first').toEqual({
      text: 'auth-required: sign in first',
      truncated: false
    });
    view.unmount();
  });

  // @contracts B-α-C22
  it('RS6: a relay nobody can read is not part of the question, and a capability-only change is still adopted', async () => {
    browserLike();
    const a = freshRelay();
    const b = freshRelay();
    const c = freshRelay();
    const d = freshRelay();
    let request: ReqHandle | undefined;
    let send: Send | undefined;
    const view = render(Host, {
      relays: [a.url, b.url],
      plans: [PLAN],
      seen: (_index: number, handed: ReqHandle) => (request = handed),
      signer,
      sender: (held: Send) => (send = held)
    });
    await waitFor(() => {
      expect(requestsTo(a.relay)).toHaveLength(1);
      expect(requestsTo(b.relay)).toHaveLength(1);
    });
    answer(a.relay, []);
    answer(b.relay, []);
    await waitFor(() => expect(request?.state.status).toBe('settled'));

    const quiet = async (label: string, counts: { a: number; b: number }): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(requestsTo(a.relay).length, label).toBe(counts.a);
      expect(requestsTo(b.relay).length, label).toBe(counts.b);
    };
    const eventsTo = (relay: WS): unknown[][] =>
      (relay.messages as unknown[][]).filter((frame) => frame[0] === 'EVENT');
    /** Send to one relay, and have that relay accept it if it is reached at all. */
    const sendTo = async (url: string, relay: WS): Promise<SendResult | undefined> => {
      const before = eventsTo(relay).length;
      const pending = send?.({ kind: 1, content: `to ${url}`, tags: [] }, { relays: [url] });
      // The poll stops when either side settles, so a refused send leaves no
      // timer running into the next arm.
      let answered = false;
      void pending?.finally(() => (answered = true));
      const settled = await Promise.race([
        pending,
        new Promise<'reached'>((resolve) => {
          const poll = (): void => {
            if (eventsTo(relay).length > before) resolve('reached');
            else if (!answered) setTimeout(poll, 10);
          };
          poll();
        })
      ]);
      if (settled !== 'reached') return settled;
      const [, event] = eventsTo(relay).at(-1) as [string, { id: string }];
      relay.send(['OK', event.id, true, '']);
      return pending;
    };

    // A write-only relay joins: no relay is asked again, and the one that
    // cannot answer a REQ is never asked anything — but it is a relay the
    // consumer can now publish to, which is the half the identity cannot see.
    await view.rerender({ relays: [a.url, b.url, { url: c.url, read: false, write: true }] });
    await quiet('a write-only relay joined', { a: 1, b: 1 });
    expect(requestsTo(c.relay), 'the write-only relay is not asked').toEqual([]);
    expect(request?.state.status).toBe('settled');
    const toC = await sendTo(c.url, c.relay);
    expect(toC?.status, 'and it can be published to').toBe('settled');
    expect(eventsTo(c.relay)).toHaveLength(1);

    // The readable relay made write-only: a narrower readable set is a new
    // question, asked of the relay still readable and not of the one that is not.
    await view.rerender({ relays: [{ url: a.url, read: false, write: true }, b.url] });
    await waitFor(() => expect(requestsTo(b.relay)).toHaveLength(2));
    await quiet('narrowed', { a: 1, b: 2 });

    // A write flag taken from a relay that stays readable: the same question,
    // and the relay can no longer be published to.
    await view.rerender({
      relays: [
        { url: a.url, read: false, write: true },
        { url: b.url, read: true, write: false }
      ]
    });
    await quiet('a write flag moved', { a: 1, b: 2 });
    const toB = await sendTo(b.url, b.relay);
    expect(toB?.status === 'refused' && toB.code, 'the flag taken away is gone').toBe(
      'relay-outside-scope'
    );
    expect(eventsTo(b.relay)).toEqual([]);

    // One readable relay swapped for another: the count is the same and the
    // question is not.
    await view.rerender({
      relays: [
        { url: a.url, read: false, write: true },
        { url: c.url, read: true, write: true }
      ]
    });
    await waitFor(() => expect(requestsTo(c.relay)).toHaveLength(1));

    // One write-only relay swapped for another: neither the identity nor the
    // count moves, and the consumer publishes where they said now.
    const settledAsks = requestsTo(c.relay).length;
    answer(c.relay, []);
    await waitFor(() => expect(request?.state.status).toBe('settled'));
    await view.rerender({
      relays: [
        { url: d.url, read: false, write: true },
        { url: c.url, read: true, write: true }
      ]
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(requestsTo(c.relay).length, 'a write-only swap is the same question').toBe(settledAsks);
    expect(requestsTo(d.relay)).toEqual([]);
    expect((await sendTo(d.url, d.relay))?.status, 'published where they said').toBe('settled');
    expect(eventsTo(d.relay)).toHaveLength(1);
    const toA = await sendTo(a.url, a.relay);
    expect(toA?.status === 'refused' && toA.code, 'and not where they used to').toBe(
      'relay-outside-scope'
    );
    view.unmount();
  }, 20_000);

  // @contracts B-α-C23
  it('RS7: the membership a consumer is handed is frozen all the way down, and a write to it is refused', async () => {
    browserLike();
    const a = freshRelay();
    const c = freshRelay();
    let diagnostics: ReturnType<typeof useRelayDiagnostics> | undefined;
    const view = render(Host, {
      relays: [a.url, { url: 'wss://b.example', read: false, write: true }],
      plans: [PLAN],
      seen: () => {},
      diagnostics: (held: ReturnType<typeof useRelayDiagnostics>) => (diagnostics = held)
    });

    /** Every level of the map a consumer holds now, and a write to each refused. */
    const expectFrozen = (label: string): void => {
      const relays = diagnostics?.relays ?? {};
      expect(Object.keys(relays).length, label).toBeGreaterThan(0);
      expect(Object.isFrozen(relays), `${label}: the map`).toBe(true);
      for (const [url, row] of Object.entries(relays)) {
        expect(Object.isFrozen(row), `${label}: ${url}'s row`).toBe(true);
        expect(Object.isFrozen(row?.configuredUrls), `${label}: ${url}'s spellings`).toBe(true);
      }
      // And the reading `isFrozen` cannot do: a write through the published
      // value is refused rather than dropped, and nothing moved.
      const row = relays['wss://b.example'];
      expect(() => {
        (row as unknown as { write: boolean }).write = false;
      }, label).toThrow(TypeError);
      expect(() => {
        (row?.configuredUrls as unknown as string[]).push('wss://elsewhere.example');
      }, label).toThrow(TypeError);
      expect(() => {
        (relays as Record<string, unknown>)['wss://elsewhere.example'] = row;
      }, label).toThrow(TypeError);
      expect(diagnostics?.relays['wss://b.example'], label).toMatchObject({
        read: false,
        write: true
      });
      expect(diagnostics?.relays['wss://b.example']?.configuredUrls, label).toEqual([
        'wss://b.example'
      ]);
      expect(diagnostics?.relays['wss://elsewhere.example'], label).toBeUndefined();
    };

    // The map at mount, and every map handed out after it: a connection that
    // moved, a NOTICE, a CLOSED, a relay list that changed and the teardown
    // each publish a new one.
    expectFrozen('at mount');
    const atMount = diagnostics?.relays;
    await waitFor(() => expect(diagnostics?.relays[a.url]?.connection).toBe('connected'));
    expect(diagnostics?.relays, 'a new map was handed out').not.toBe(atMount);
    expectFrozen('after the connection moved');
    a.relay.send(['NOTICE', 'hello']);
    await waitFor(() => expect(diagnostics?.relays[a.url]?.lastNotice?.text).toBe('hello'));
    expectFrozen('after a NOTICE');
    const [, subscription] = requestsTo(a.relay)[0] as [string, string];
    a.relay.send(['CLOSED', subscription, 'error: shutting down']);
    await waitFor(() => expect(diagnostics?.relays[a.url]?.lastRefusal).toBeDefined());
    expectFrozen('after a CLOSED');
    await view.rerender({
      relays: [a.url, { url: 'wss://b.example', read: false, write: true }, c.url]
    });
    await waitFor(() => expect(Object.keys(diagnostics?.relays ?? {})).toHaveLength(3));
    expectFrozen('after the relay list changed');

    // And the map a consumer goes on holding after the provider is gone.
    view.unmount();
    const after = diagnostics?.relays ?? {};
    expect(Object.keys(after), 'torn down').toEqual([]);
    expect(Object.isFrozen(after), 'torn down: the map').toBe(true);
    expect(() => {
      (after as Record<string, unknown>)['wss://elsewhere.example'] = {};
    }).toThrow(TypeError);
    expect(Object.keys(diagnostics?.relays ?? {}), 'and nothing moved').toEqual([]);
  });
});
