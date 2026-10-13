/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What an event has to be to be admitted or sent: `A-ε-C18`'s landing, `AH1`;
 * and that the provider's verifier is the one a request is checked by:
 * `A-ε-C17`'s, `AH2`.
 *
 * Driven through the published entry only — a mounted `NostrApp` given relays
 * and a signer, `useReq` and `useSend` under it — so the verifier is the one
 * the library supplies, as it is for every consumer: `0004` publishes none.
 * Every event is signed with a real key. Each one `AH1` refuses is built so
 * that only one half of the rule refuses it, and `AH2`'s are the row's own
 * arrangement, which both halves refuse:
 *
 * - **a rewritten id**: signed correctly over its own fields, with `id` set to
 *   something else — another author's id, a coordinate's key, its own hash in
 *   upper case, its own hash with the last character changed, its own hash
 *   with a character added. Only the id comparison refuses it, and only an
 *   exact one: a comparison of a prefix takes the last two.
 * - **a signature that is not over the hash**: the fields changed, `id`
 *   recomputed from them, and the old signature kept. Its id is its hash, so
 *   only the signature check refuses it — "a genuine signature over different
 *   content" with the old id would be refused by the id comparison alone.
 * - **a signature that is not hex**: the schnorr check throws on it.
 *
 * Port band 9220-9249.
 */
import { render, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrSigner, ReqEvent, ReqPlan, SendResult } from '$lib/v1/index.js';

import Host from './admission/Host.svelte';
import type { Held } from './admission/Probe.svelte';

// The provider is the subject, and it reads the real context.
vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const VICTIM = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const ATTACKER = '0000000000000000000000000000000000000000000000000000000000000001';

type Fields = Pick<Nostr.Event, 'kind' | 'created_at' | 'tags' | 'content'>;

/** An event signed correctly over its own fields. */
const signed = (seckey: string, fields: Fields): Nostr.Event => {
  const unsigned = { ...fields, pubkey: getPublicKey(seckey) };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, seckey) };
};

/** `event` with different fields, its id recomputed from them, and its old signature. */
const resigned = (event: Nostr.Event, fields: Partial<Fields>): Nostr.Event => {
  const changed = { ...event, ...fields };
  return { ...changed, id: getEventHash(changed) };
};

/**
 * The seven fields NIP-01 gives an event, so a comparison is of the whole of
 * what the id and the signature commit to. `ots`, which a `ReqEvent` carries
 * when the wire did, is not read: the signature does not cover it, and a send
 * drops it today (#164).
 */
const whole = (event: Nostr.Event | ReqEvent) => ({
  id: event.id,
  pubkey: event.pubkey,
  created_at: event.created_at,
  kind: event.kind,
  tags: event.tags.map((tag) => [...tag]),
  content: event.content,
  sig: event.sig
});

/**
 * A signer that hands back whatever `rewrite` makes of a correct signature,
 * and keeps what it handed back — a signature is not reproducible, so the
 * event that should reach the wire is read off the signer.
 */
const signerOf = (
  seckey: string,
  rewrite: (event: Nostr.Event) => Nostr.Event = (event) => event
): NostrSigner & { readonly returned: Nostr.Event[] } => {
  const returned: Nostr.Event[] = [];
  return {
    returned,
    signEvent: async (template) => {
      const event = rewrite(
        signed(seckey, { ...template, tags: template.tags.map((tag) => [...tag]) })
      );
      returned.push(event);
      return event;
    }
  };
};

const settle = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const byId = <T extends { id: string }>(events: readonly T[]): T[] =>
  [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

let port = 9220;

/** A request over kinds 1 and 10000 that also stays open: both legs. */
const LIVE: ReqPlan = {
  kind: 'request',
  descriptor: {
    filters: [{ kinds: [1, 10000] }],
    live: true,
    retain: 'unbounded',
    settleTimeoutMs: 2_000
  }
};

/**
 * A relay, a provider over it and one consumer per plan under that. The relay
 * answers every EVENT it is sent with `OK`, so a send that should have been
 * refused and was not fails on what it returns rather than waiting out the
 * library's `OK` timeout. Each request's subscriptions are told apart by the
 * leg in their name and the kinds in their filter, so every plan here asks for
 * a different set of kinds.
 */
async function consumer({
  signer = signerOf(VICTIM),
  plans = [LIVE]
}: { signer?: NostrSigner; plans?: readonly ReqPlan[] } = {}) {
  port += 1;
  const url = `ws://localhost:${String(port)}`;
  const relay = new WS(url, { jsonProtocol: true });
  relay.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as unknown[];
      if (frame[0] === 'EVENT')
        socket.send(JSON.stringify(['OK', (frame[1] as { id: string }).id, true, '']));
    });
  });
  const held: Held[] = [];
  const view = render(Host, {
    relays: [url],
    signer,
    plans: plans.map((plan) => () => plan),
    expose: (handed: Held, index: number) => {
      held[index] = handed;
    }
  });
  const kindsOf = (plan: ReqPlan): string =>
    plan.kind === 'request' ? JSON.stringify(plan.descriptor.filters[0]?.kinds) : '';
  const expected = plans.reduce(
    (sum, plan) => sum + (plan.kind === 'request' && plan.descriptor.live === true ? 2 : 1),
    0
  );
  // **Bounded, and failing on what the requests say.** A request that refuses
  // before it asks the relay — one left with no verifier refuses that way —
  // would otherwise leave this waiting until the test's own timeout, which says
  // nothing about why.
  const subscriptions: { id: string; kinds: string }[] = [];
  await vi.waitFor(
    () => {
      subscriptions.splice(
        0,
        subscriptions.length,
        ...(relay.messages as unknown[][])
          .filter((frame) => frame[0] === 'REQ')
          .map((frame) => ({
            id: String(frame[1]),
            kinds: JSON.stringify((frame[2] as { kinds?: unknown }).kinds)
          }))
      );
      expect(
        subscriptions.length,
        `every request asked the relay; their states are ${JSON.stringify(
          held.map(({ request }) =>
            request.state.status === 'error' ? String(request.state.error) : request.state.status
          )
        )}`
      ).toBeGreaterThanOrEqual(expected);
    },
    { timeout: 5000 }
  );
  const requests = plans.map((plan, index) => {
    const handed = held[index];
    if (handed === undefined) throw new Error('nosvelte test: a probe handed nothing over');
    const mine = subscriptions.filter((one) => one.kinds === kindsOf(plan));
    const backward = mine.find((one) => one.id.includes('-b'))?.id;
    const forward = mine.find((one) => one.id.includes('-f'))?.id;
    if (backward === undefined)
      throw new Error(`nosvelte test: the subscriptions were ${JSON.stringify(subscriptions)}`);
    const { request } = handed;
    const events = (): ReturnType<typeof whole>[] =>
      request.state.status === 'loading' ? [] : request.state.events.map(whole);
    return { request, events, backward, forward: forward ?? '' };
  });
  const send = held[0]?.send;
  if (send === undefined) throw new Error('nosvelte test: no send was handed over');
  /** Every EVENT frame on the wire, whole. */
  const sent = (): ReturnType<typeof whole>[] =>
    (relay.messages as unknown[][])
      .filter((frame) => frame[0] === 'EVENT')
      .map((frame) => whole(frame[1] as Nostr.Event));
  /**
   * The wire once the consumer has gone and anything it started has had time
   * to arrive: a send left running is refused by the provider's revoked
   * capability after this, so this is everything the consumer put out.
   *
   * **A wait while it is still mounted comes first.** A send deferred past
   * the refusal reached the socket after the marker had been answered, and
   * unmounting at once revoked it before it went: green, for a consumer that
   * stays mounted and would have sent it — measured. What this does not see is
   * a send deferred longer than the wait; one deferred past the consumer's
   * lifetime is refused by the revoked capability.
   */
  const finalWire = async (): Promise<ReturnType<typeof whole>[]> => {
    await settle(300);
    view.unmount();
    await settle(100);
    return sent();
  };
  return { relay, requests, send, sent, finalWire };
}

describe('what an event has to be to be admitted or sent', () => {
  // @contracts A-ε-C18
  it(
    'AH1: an event is admitted or sent only when its id is the hash of its fields and its signature is over that hash, on every door',
    { timeout: 60_000 },
    async () => {
      vi.stubGlobal('WebSocket', MockWebSocket);
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
      // Every method the console has, not five of them.
      const levels = Object.getOwnPropertyNames(console).filter(
        (name) =>
          name !== 'Console' &&
          typeof (console as unknown as Record<string, unknown>)[name] === 'function'
      ) as (keyof Console)[];
      const spies = levels.map((level) =>
        vi.spyOn(console, level as 'log').mockImplementation(() => undefined)
      );

      const genuine = signed(VICTIM, { kind: 1, created_at: 100, tags: [], content: 'genuine' });
      const theirs = signed(ATTACKER, { kind: 1, created_at: 100, tags: [], content: 'forged' });
      // **The attack**: the attacker's own event, under the victim's id.
      const takeover = { ...theirs, id: genuine.id };
      const list = signed(VICTIM, { kind: 10000, created_at: 100, tags: [], content: 'mutes' });
      // A regular event is keyed by its id, so this one is keyed where the
      // victim's kind-10000 revision is, and it is later.
      const collision = {
        ...signed(ATTACKER, { kind: 1, created_at: 200, tags: [], content: 'collides' }),
        id: `10000:${list.pubkey}`
      };
      const own = (content: string, created_at: number): Nostr.Event =>
        signed(ATTACKER, { kind: 1, created_at, tags: [], content });
      // Its own hash, respelled: in upper case, which a comparison ignoring
      // case takes; with the last character changed, which a comparison of a
      // prefix takes; and with a character added, which one of the hash as a
      // prefix of the id takes.
      const shouting = ((event) => ({ ...event, id: event.id.toUpperCase() }))(own('loud', 101));
      const lastChanged = ((event) => ({
        ...event,
        id: `${event.id.slice(0, -1)}${event.id.endsWith('0') ? '1' : '0'}`
      }))(own('close', 104));
      const suffixed = ((event) => ({ ...event, id: `${event.id}0` }))(own('longer', 105));
      const notOverIt = resigned(genuine, { content: 'not what was signed' });
      const notHex = { ...own('x', 102), sig: 'zz' };
      // **And what verified before still verifies**: fields whose serialization
      // escapes and does not, outside ASCII, and a character written as two
      // code points that normalization would fold into one.
      const awkward = signed(ATTACKER, {
        kind: 1,
        created_at: 103,
        tags: [
          ['t', 'ünïcödé'],
          ['e', 'a"b\\c', '']
        ],
        content:
          'quote " backslash \\ newline \n tab \t emoji \u{1F9A9} separator   nul \u0000 é decomposed é'
      });
      expect(
        [takeover, collision, shouting, lastChanged, suffixed, notHex, notOverIt].map(
          (one) => getEventHash(one) === one.id
        ),
        'the premise: each rewritten id is not its hash, and the others are'
      ).toEqual([false, false, false, false, false, true, true]);
      expect(
        [
          lastChanged.id.slice(0, -1) === getEventHash(lastChanged).slice(0, -1),
          suffixed.id.startsWith(getEventHash(suffixed)),
          awkward.content !== awkward.content.normalize('NFC')
        ],
        'the premise: the respelled ids agree with their hashes but for the end, and the awkward content is not normalized'
      ).toEqual([true, true, true]);
      // The comparison is of the whole event, so the takeover — the victim's id
      // and nothing else of the victim's — is not read as the victim's event.
      expect(whole(takeover), 'the premise: the comparison tells the takeover apart').not.toEqual(
        whole(genuine)
      );

      // **(1) and (2) Both legs.** The takeover arrives before the victim's
      // event and the collision after the victim's revision, so either one
      // admitted displaces what the consumer should hold. The others are
      // refused on their own, and any one admitted is an extra in the list.
      // The attacker's own event comes after the attacker's forgeries, so a
      // verifier that held a refusal against the key would drop it: it is the
      // id that is refused, not the key.
      const offered = [
        takeover,
        genuine,
        list,
        collision,
        shouting,
        lastChanged,
        suffixed,
        notOverIt,
        notHex,
        theirs,
        awkward
      ];
      const held = byId([genuine, list, theirs, awkward].map(whole));
      {
        const { relay, requests, finalWire } = await consumer();
        const [{ backward, events, request }] = requests as [(typeof requests)[number]];
        for (const packet of offered) relay.send(['EVENT', backward, packet]);
        relay.send(['EOSE', backward]);
        await waitFor(() => expect(request.state.status).not.toBe('loading'));
        await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(held.length));
        expect(byId(events()), 'backward: what the consumer holds').toEqual(held);
        await finalWire();
      }
      {
        const { relay, requests, finalWire } = await consumer();
        const [{ backward, forward, events, request }] = requests as [(typeof requests)[number]];
        relay.send(['EOSE', backward]);
        await waitFor(() => expect(request.state.status).not.toBe('loading'));
        for (const packet of offered) relay.send(['EVENT', forward, packet]);
        await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(held.length));
        expect(byId(events()), 'forward: what the consumer holds').toEqual(held);
        await finalWire();
      }

      // **(3) A verdict is not carried from one request to the next.** Two
      // requests under one provider: the victim's event admitted on the first,
      // then the takeover offered first on the second. A verifier that kept
      // its verdicts by id passed it there, and every door above, with one
      // request each, stayed green: measured.
      {
        const kinds = (set: number[]): ReqPlan => ({
          kind: 'request',
          descriptor: { filters: [{ kinds: set }], settleTimeoutMs: 2_000 }
        });
        const { relay, requests, finalWire } = await consumer({
          plans: [kinds([1]), kinds([1, 10000])]
        });
        const [first, second] = requests as [(typeof requests)[number], (typeof requests)[number]];
        relay.send(['EVENT', first.backward, genuine]);
        relay.send(['EOSE', first.backward]);
        await waitFor(() => expect(first.events()).toEqual([whole(genuine)]));
        relay.send(['EVENT', second.backward, takeover]);
        relay.send(['EVENT', second.backward, genuine]);
        relay.send(['EOSE', second.backward]);
        await waitFor(() => expect(second.request.state.status).not.toBe('loading'));
        await waitFor(() => expect(second.events().length).toBeGreaterThanOrEqual(1));
        expect(
          [first.events(), second.events()],
          'the second request holds the victim’s event too, not the takeover'
        ).toEqual([[whole(genuine)], [whole(genuine)]]);
        await finalWire();
      }

      // **(4) A signed input to `useSend`**: refused, resolving rather than
      // rejecting. Then a genuine one, which goes out as it is and is the wire
      // reader's control. **The wire is read once the consumer has gone**: a
      // refusal returns before anything a send started could reach the socket,
      // and read right after the refusals it was empty for a send that went
      // out anyway — measured.
      {
        const { send, finalWire } = await consumer();
        const answers: SendResult[] = [];
        for (const input of [takeover, notOverIt, notHex]) answers.push(await send(input));
        expect(
          answers.map((answer) => (answer.status === 'refused' ? answer.code : answer.status)),
          'a signed input whose id is not its hash, whose signature is not over it, or is not hex'
        ).toEqual(['invalid-event', 'invalid-event', 'invalid-event']);
        const out = await send(awkward);
        expect(
          [out.status, out.status === 'settled' ? whole(out.event) : undefined],
          'a genuine one goes out as it is'
        ).toEqual(['settled', whole(awkward)]);
        expect(await finalWire(), 'and it is the only event on the wire, whole').toEqual([
          whole(awkward)
        ]);
      }

      // **(5) What a signer returns**, the template unchanged in every case so
      // only the verifier can refuse it: its id rewritten, another event's
      // signature, a signature that is not hex. A genuine signed input follows
      // each, as the marker the wire is read against; and a signer that
      // returns what it signed goes out, as itself.
      const template: Fields = { kind: 1, created_at: 300, tags: [['t', 'x']], content: 'post' };
      for (const [label, rewrite] of [
        ['an id that is not its hash', (event: Nostr.Event) => ({ ...event, id: genuine.id })],
        ['a signature not over its hash', (event: Nostr.Event) => ({ ...event, sig: genuine.sig })],
        ['a signature that is not hex', (event: Nostr.Event) => ({ ...event, sig: 'zz' })]
      ] as const) {
        const { send, finalWire } = await consumer({ signer: signerOf(VICTIM, rewrite) });
        const answer = await send(template);
        const marker = await send(awkward);
        expect(
          [answer.status === 'refused' ? answer.code : answer.status, marker.status],
          `a signer returning ${label}: refused, resolving`
        ).toEqual(['signer-failed', 'settled']);
        expect(
          await finalWire(),
          `a signer returning ${label}: only the marker on the wire`
        ).toEqual([whole(awkward)]);
      }
      {
        const signer = signerOf(VICTIM);
        const { send, finalWire } = await consumer({ signer });
        const answer = await send(template);
        const [returned] = signer.returned;
        if (returned === undefined) throw new Error('nosvelte test: the signer was not asked');
        expect(
          [answer.status, answer.status === 'settled' ? whole(answer.event) : undefined],
          'a signer returning what it signed: it goes out, as itself'
        ).toEqual(['settled', whole(returned)]);
        expect(await finalWire(), 'and it is on the wire, whole').toEqual([whole(returned)]);
      }

      // **Nothing was written to the console** while any of it was refused —
      // read with its control: one line written through every method, which
      // are then the only calls.
      for (const level of levels)
        (console[level] as (...args: unknown[]) => void)('nosvelte test: the control');
      expect(
        spies.map((spy) => spy.mock.calls),
        'verification writes nothing to the console, by any method'
      ).toEqual(levels.map(() => [['nosvelte test: the control']]));
    }
  );

  // @contracts A-ε-C17
  it(
    'AH2: an event changed after it was signed does not reach a consumer of a request made through a provider',
    { timeout: 30_000 },
    async () => {
      vi.stubGlobal('WebSocket', MockWebSocket);
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));

      // **The row's own arrangement**: a genuine signature over different
      // content — the id and the signature of an event signed for real, with its
      // content changed afterwards. One such pair for each door a request takes
      // events in by: its backward leg, its forward leg, and the backward leg of
      // a refresh, which runs outside the component's initialisation and so
      // cannot look the provider up again. The changed event comes first, so one
      // admitted is the event the consumer holds: the fold keeps the first of an
      // id (`B5-C3`). Nothing names a verifier anywhere, because nothing
      // published takes one; the provider's is the only one there is, and it
      // reaches the machine or nothing checks.
      const pairs = (['backward', 'forward', 'refreshed'] as const).map((door, index) => {
        const genuine = signed(VICTIM, {
          kind: 1,
          created_at: 100 * (index + 1),
          tags: [],
          content: `signed for the ${door} leg`
        });
        return { door, genuine, changed: { ...genuine, content: `changed on the ${door} leg` } };
      });
      expect(
        pairs.map(({ genuine, changed }) => [
          changed.id === genuine.id,
          changed.sig === genuine.sig,
          changed.content === genuine.content
        ]),
        'the premise: the same id and signature, over different content'
      ).toEqual(pairs.map(() => [true, true, false]));
      // Through the comparison the arm reads with, not only the field: a
      // `whole()` that read the id alone would take one for the other.
      expect(
        pairs.filter(
          ({ genuine, changed }) =>
            JSON.stringify(whole(changed)) === JSON.stringify(whole(genuine))
        ),
        'the premise: the comparison tells each pair apart'
      ).toEqual([]);
      type Pair = (typeof pairs)[number];
      const [backwardPair, forwardPair, refreshedPair] = pairs as [Pair, Pair, Pair];

      const { relay, requests, finalWire } = await consumer();
      const [{ backward, forward, events, request }] = requests as [(typeof requests)[number]];
      relay.send(['EVENT', backward, backwardPair.changed]);
      relay.send(['EVENT', backward, backwardPair.genuine]);
      relay.send(['EOSE', backward]);
      await waitFor(() => expect(request.state.status).not.toBe('loading'));
      await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(1));
      relay.send(['EVENT', forward, forwardPair.changed]);
      relay.send(['EVENT', forward, forwardPair.genuine]);
      await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(2));

      const refreshed = request.refresh();
      let again: string | undefined;
      await vi.waitFor(
        () => {
          again = (relay.messages as unknown[][])
            .filter((frame) => frame[0] === 'REQ')
            .map((frame) => String(frame[1]))
            .filter((id) => id.includes('-b') && id !== backward)
            .at(-1);
          expect(
            again,
            `the refresh asked the relay; the request is ${JSON.stringify(
              request.state.status === 'error' ? String(request.state.error) : request.state.status
            )}`
          ).toBeDefined();
        },
        { timeout: 5000 }
      );
      relay.send(['EVENT', again, refreshedPair.changed]);
      relay.send(['EVENT', again, refreshedPair.genuine]);
      relay.send(['EOSE', again]);
      await refreshed;
      await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(3));
      // The handle lists by `created_at`, newest first, which is why each pair
      // is later than the one before it: the order expected is the published
      // one, not the order of arrival.
      expect(events(), 'what the consumer holds: the genuine event of each pair').toEqual([
        whole(refreshedPair.genuine),
        whole(forwardPair.genuine),
        whole(backwardPair.genuine)
      ]);
      await finalWire();
    }
  );
});
