/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What an event has to be to be admitted or sent: `A-ε-C18`'s landing, `AH1`.
 *
 * Driven through the published entry only — a mounted `NostrApp` given relays
 * and a signer, `useReq` and `useSend` under it — so the verifier is the one
 * the library supplies, as it is for every consumer: `0004` publishes none.
 * Every event is signed with a real key, and each refused one is built so that
 * only one half of the rule refuses it:
 *
 * - **a rewritten id**: signed correctly over its own fields, with `id` set to
 *   something else — another author's id, a coordinate's key, its own hash in
 *   upper case. Only the id comparison refuses it.
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

/** Every field a consumer holds of an event, so a comparison is of the whole. */
const whole = (event: Nostr.Event | ReqEvent) => ({
  id: event.id,
  pubkey: event.pubkey,
  created_at: event.created_at,
  kind: event.kind,
  tags: event.tags.map((tag) => [...tag]),
  content: event.content,
  sig: event.sig
});

/** A signer that hands back whatever `rewrite` makes of a correct signature. */
const signerOf = (
  seckey: string,
  rewrite: (event: Nostr.Event) => Nostr.Event = (event) => event
): NostrSigner => ({
  signEvent: async (template) =>
    rewrite(signed(seckey, { ...template, tags: template.tags.map((tag) => [...tag]) }))
});

let port = 9220;

/**
 * A relay, a provider over it and a consumer under that, the consumer's
 * request live over kinds 1 and 10000. The relay answers every EVENT it is sent
 * with `OK`, so a send that should have been refused and was not fails on what
 * it returns, rather than waiting out the library's `OK` timeout.
 */
async function consumer(signer: NostrSigner = signerOf(VICTIM)) {
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
  let held: Held | undefined;
  const plan = (): ReqPlan => ({
    kind: 'request',
    descriptor: {
      filters: [{ kinds: [1, 10000] }],
      live: true,
      retain: 'unbounded',
      settleTimeoutMs: 2_000
    }
  });
  const view = render(Host, {
    relays: [url],
    signer,
    plan,
    expose: (handed: Held) => {
      held = handed;
    }
  });
  if (held === undefined) throw new Error('nosvelte test: the probe handed nothing over');
  // The forward leg's REQ goes first and the backward leg's second, each named
  // for its leg.
  const subscriptions: string[] = [];
  while (subscriptions.length < 2) {
    const frame = (await relay.nextMessage) as unknown[];
    if (frame[0] === 'REQ') subscriptions.push(String(frame[1]));
  }
  const forward = subscriptions.find((id) => id.includes('-f'));
  const backward = subscriptions.find((id) => id.includes('-b'));
  if (forward === undefined || backward === undefined)
    throw new Error(`nosvelte test: the legs' subscriptions were ${subscriptions.join(', ')}`);
  const { request, send } = held;
  const events = (): ReturnType<typeof whole>[] =>
    request.state.status === 'loading' ? [] : request.state.events.map(whole);
  const sent = (): unknown[][] =>
    (relay.messages as unknown[][]).filter((frame) => frame[0] === 'EVENT');
  return { relay, view, forward, backward, request, send, events, sent };
}

describe('what an event has to be to be admitted or sent', () => {
  // @contracts A-ε-C18
  it(
    'AH1: an event is admitted or sent only when its id is the hash of its fields and its signature is over that hash, on every door',
    { timeout: 60_000 },
    async () => {
      vi.stubGlobal('WebSocket', MockWebSocket);
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
      const console_ = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => undefined)
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
      // Its own hash, spelled in upper case: a comparison that ignores case
      // takes it, and only that one.
      const shouting = (() => {
        const own = signed(ATTACKER, { kind: 1, created_at: 101, tags: [], content: 'loud' });
        return { ...own, id: own.id.toUpperCase() };
      })();
      const notOverIt = resigned(genuine, { content: 'not what was signed' });
      const notHex = {
        ...signed(ATTACKER, { kind: 1, created_at: 102, tags: [], content: 'x' }),
        sig: 'zz'
      };
      // **And what verified before still verifies**: fields whose serialization
      // escapes and does not, tags included.
      const awkward = signed(ATTACKER, {
        kind: 1,
        created_at: 103,
        tags: [
          ['t', 'ünïcödé'],
          ['e', 'a"b\\c', '']
        ],
        content: 'quote " backslash \\ newline \n tab \t emoji 🦩 separator \u2028 nul \u0000 é'
      });
      expect(
        [takeover, collision, shouting, notHex].map((one) => getEventHash(one) === one.id),
        'the premise: each rewritten id is not its hash, and the others are'
      ).toEqual([false, false, false, true]);
      expect(
        getEventHash(notOverIt) === notOverIt.id,
        'the premise: this one’s id is its hash'
      ).toBe(true);
      // The comparison is of the whole event, so the takeover — the victim's id
      // and nothing else of the victim's — is not read as the victim's event.
      expect(whole(takeover), 'the premise: the comparison tells the takeover apart').not.toEqual(
        whole(genuine)
      );

      // **(1) The backward leg.** Each refused packet arrives before what the
      // consumer should be holding, so a packet admitted would be the one held.
      {
        const { relay, view, backward, events, request } = await consumer();
        for (const packet of [takeover, genuine, collision, list, shouting, notOverIt, notHex])
          relay.send(['EVENT', backward, packet]);
        relay.send(['EVENT', backward, awkward]);
        relay.send(['EOSE', backward]);
        await waitFor(() => expect(request.state.status).not.toBe('loading'));
        await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(3));
        expect(
          sortedById(events()),
          'backward: the victim’s event, the victim’s revision and the awkward one, and nothing refused'
        ).toEqual(sortedById([genuine, list, awkward].map(whole)));
        view.unmount();
      }

      // **(2) The forward leg**, after the backlog ends empty: the same, live.
      {
        const { relay, view, forward, backward, events, request } = await consumer();
        relay.send(['EOSE', backward]);
        await waitFor(() => expect(request.state.status).not.toBe('loading'));
        for (const packet of [takeover, genuine, collision, list, shouting, notOverIt, notHex])
          relay.send(['EVENT', forward, packet]);
        relay.send(['EVENT', forward, awkward]);
        await waitFor(() => expect(events().length).toBeGreaterThanOrEqual(3));
        expect(
          sortedById(events()),
          'forward: the victim’s event, the victim’s revision and the awkward one, and nothing refused'
        ).toEqual(sortedById([genuine, list, awkward].map(whole)));
        view.unmount();
      }

      // **(3) The attacker's own event, unaltered, is admitted**: it is the id
      // that is refused, not the key.
      {
        const { relay, view, backward, events, request } = await consumer();
        relay.send(['EVENT', backward, theirs]);
        relay.send(['EOSE', backward]);
        await waitFor(() => expect(request.state.status).not.toBe('loading'));
        await waitFor(() => expect(events()).toEqual([whole(theirs)]));
        view.unmount();
      }

      // **(4) A signed input to `useSend`**: refused, and nothing on the wire;
      // a genuine one goes out, which is the wire reader's own control.
      {
        const { view, send, sent } = await consumer();
        const answers: SendResult[] = [];
        for (const input of [takeover, notOverIt, notHex]) answers.push(await send(input));
        expect(
          answers.map((answer) => (answer.status === 'refused' ? answer.code : answer.status)),
          'a signed input whose id is not its hash, whose signature is not over it, or is not hex'
        ).toEqual(['invalid-event', 'invalid-event', 'invalid-event']);
        expect(sent(), 'and none of them reached the wire').toEqual([]);
        const out = await send(awkward);
        expect(
          [out.status, out.status === 'settled' ? whole(out.event) : undefined],
          'a genuine one goes out as it is'
        ).toEqual(['settled', whole(awkward)]);
        expect(
          sent().map((frame) => (frame[1] as { id: string }).id),
          'and is on the wire'
        ).toEqual([awkward.id]);
        view.unmount();
      }

      // **(5) What a signer returns**, the template unchanged in every case so
      // only the verifier can refuse it: its id rewritten, its fields re-signed
      // by nobody, its signature not hex; and a signer that returns what it
      // signed, which goes out.
      const template: Fields = { kind: 1, created_at: 300, tags: [['t', 'x']], content: 'post' };
      for (const [label, rewrite] of [
        ['an id that is not its hash', (event: Nostr.Event) => ({ ...event, id: genuine.id })],
        ['a signature not over its hash', (event: Nostr.Event) => ({ ...event, sig: genuine.sig })],
        ['a signature that is not hex', (event: Nostr.Event) => ({ ...event, sig: 'zz' })]
      ] as const) {
        const { view, send, sent } = await consumer(signerOf(VICTIM, rewrite));
        const answer = await send(template);
        expect(
          [answer.status === 'refused' ? answer.code : answer.status, sent()],
          `a signer returning ${label}: refused, and nothing on the wire`
        ).toEqual(['signer-failed', []]);
        view.unmount();
      }
      {
        const { view, send, sent } = await consumer(signerOf(VICTIM));
        const answer = await send(template);
        expect(
          [answer.status, sent().length],
          'a signer returning what it signed: it goes out'
        ).toEqual(['settled', 1]);
        view.unmount();
      }

      // **Nothing was written to the console** while any of it was refused —
      // read with its control, a line written here, which is the only one.
      console.warn('nosvelte test: the console reader’s control');
      expect(
        console_.flatMap((spy) => spy.mock.calls),
        'verification writes nothing to the console'
      ).toEqual([['nosvelte test: the console reader’s control']]);
    }
  );
});

function sortedById<T extends { id: string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
