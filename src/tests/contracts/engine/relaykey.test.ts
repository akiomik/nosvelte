/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Ported from the spike's `relaykey` suite onto `src/lib/v1`, against the
 * engine's own seam. The arms are renamed from `SC<n>` to `SG<n>` — 0005
 * records the old names as spike witnesses, and a production arm carries a
 * name of its own. **The comments keep the spike's names**, because what they
 * record was measured there: `SC1` in a comment is the arm that is `SG1`
 * here, and every other arm name in a comment is the spike's as 0005 records
 * it, not a file in this repository. Likewise "the ledger" is the spike's
 * mutation ledger, and a function or a file a comment names that this
 * repository does not have (`configOf`, `roles.ts`, `context.test.ts`, …) is
 * the spike's.
 *
 * What the spike's suite said of itself:
 *
 * B-α's falsifier, on the wire.
 *
 * `SC10` measures what a scope calls two spellings of one relay and `SC15`
 * measures that this library's own transcription still agrees with the resolved
 * client. Neither says what a disagreement *costs*, and the cost
 * is the reason B-α is a decision rather than a tidiness rule: the machine keys
 * its per-relay backward table by the scope's spelling and rx-nostr stamps
 * `packet.from` with its own, so two spellings of one relay make `advanceBackward`
 * drop the EOSE as an unknown key — and the relay that answered stays
 * undetermined until A-γ's timer calls it a network timeout.
 *
 * That is a public outcome: `{ kind: 'incomplete', causes: ['timeout'] }` for a
 * backlog that was answered in full. So it is measured here, end to end, over a
 * real client and a real socket.
 *
 * **Why these carry `SC` ids in a file of their own.** They belong to B-α's
 * family, but what they assert is a `BacklogEnd` — the shape `machine.test.ts`
 * exists to observe — and they drive `referenceStream` directly rather than the
 * scope value. Neither file is the obvious home, so they get one that says what
 * they are about.
 *
 * Not all of them are contract witnesses. `SC19` and `SC20` drive the
 * scope-less branch of `requestTargets`, which the intended public API has no
 * caller for, and are classified as spike implementation regressions in
 * `roles.ts` instead.
 */
import { WebSocket } from 'mock-socket';
import type { IWebSocketConstructor, RxNostr } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { afterEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import { referenceStream } from '$lib/v1/machine.js';
import { createRelayScope, NonIdempotentRelayUrlError } from '$lib/v1/scope.svelte.js';
import type { MachineChunk } from '$lib/v1/stream.js';
import { requestTargets } from '$lib/v1/stream.js';

import { acceptAnyEvent, permanentTransport } from './helpers/relay.js';

let port = 9880;
const nextHost = () => `ws://localhost:${(port += 1)}`;

const client = (): RxNostr =>
  createRxNostr({
    websocketCtor: WebSocket as unknown as IWebSocketConstructor,
    skipVerify: true,
    skipFetchNip11: true,
    retry: { strategy: 'off' }
  });

async function collect(stream: AsyncGenerator<MachineChunk>): Promise<MachineChunk[]> {
  const chunks: MachineChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const endsOf = (chunks: MachineChunk[]) =>
  chunks.filter((chunk) => chunk.type === 'settled').map((chunk) => chunk.end);

describe('B-α: one relay, one spelling, all the way to the outcome', () => {
  afterEach(() => WS.clean());

  it('SG16: an EOSE from a relay whose query is escaped settles the backlog complete', async () => {
    // The review's counterexample, kept as a contract. The scope is given a URL
    // with a percent-escape in its query; rx-nostr connects under its own
    // spelling of that URL, so the mock relay stands at the decoded one and the
    // packet comes back named that way. The scope's name for it is the
    // transport's own answer to the string written here (`TD1`), so if the
    // chain between the two comes apart anywhere — a name minted somewhere
    // other than the transport, a name written through that the transport would
    // rename again — the EOSE below is attributed to nothing and this reports a
    // timeout. It used to be `canonicalUrl` on this side of the chain, which is
    // the same trace with one more thing that could be wrong.
    //
    // `toEqual` and not `toMatchObject`: the failure this is written against
    // produces `{ kind: 'incomplete', causes: ['timeout'] }`, and a partial
    // match against `{ kind: 'complete' }` would be satisfied by neither shape
    // — but a partial match written the other way round, or a later `causes`
    // entry creeping in beside a `complete`, is exactly what an exact
    // comparison is for.
    const host = nextHost();
    const asked = `${host}/?x=%7E`;
    // Not written out as a literal: what the client connects to is the
    // dependency's decision, and `SEN25` is where that decision is recorded.
    // Taken from a throwaway client so that this test's own client is set up
    // only once, by the scope.
    const probe = client();
    probe.setDefaultRelays([asked]);
    const connected = Object.keys(probe.getAllRelayStatus())[0] as string;
    probe.dispose();
    // The premise, asserted rather than assumed: if these were the same string
    // the test would pass without measuring anything.
    expect(connected).not.toBe(asked);

    const server = new WS(connected, { jsonProtocol: true });
    const rxNostr = client();
    const scope = createRelayScope(rxNostr, [asked]);
    const ac = new AbortController();
    const stream = referenceStream({
      verifyEvent: acceptAnyEvent,
      transport: permanentTransport(rxNostr),
      // The production path: the machine's targets come from the scope, which
      // is where the two spellings meet.
      targets: requestTargets(permanentTransport(rxNostr), scope.current),
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'sc16',
      signal: ac.signal,
      timeoutMs: 3000
    });

    const done = collect(stream);
    await server.connected;
    server.send(['EOSE', String(((await server.nextMessage) as unknown[])[1])]);

    // Whole, with no cause and no error. Before the repair this was
    // `{ kind: 'incomplete', causes: ['timeout'] }`, three seconds later.
    expect(endsOf(await done)).toEqual([{ kind: 'complete' }]);

    rxNostr.dispose();
  }, 10_000);

  it('SG17: the same wiring reports a timeout when the relay says nothing', async () => {
    // `SC16`'s control. Without it, an assertion that a backlog is `complete`
    // is satisfied by an instrument that cannot say anything else — and the
    // defect it is written against produces the *other* value, so "it says
    // complete" only means something once "it can say incomplete" has been
    // seen in the same file, under the same escaped URL and the same scope.
    const host = nextHost();
    const asked = `${host}/?x=%7E`;
    const probe = client();
    probe.setDefaultRelays([asked]);
    const connected = Object.keys(probe.getAllRelayStatus())[0] as string;
    probe.dispose();

    const server = new WS(connected, { jsonProtocol: true });
    const rxNostr = client();
    const scope = createRelayScope(rxNostr, [asked]);
    const ac = new AbortController();
    const stream = referenceStream({
      verifyEvent: acceptAnyEvent,
      transport: permanentTransport(rxNostr),
      targets: requestTargets(permanentTransport(rxNostr), scope.current),
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'sc17',
      signal: ac.signal,
      timeoutMs: 150
    });

    const done = collect(stream);
    await server.connected;
    // The REQ is read and left unanswered: the relay is reachable and silent,
    // which is the state `SC16`'s failure mode is indistinguishable from.
    await server.nextMessage;

    expect(endsOf(await done)).toEqual([
      { kind: 'incomplete', causes: ['timeout'], error: undefined }
    ]);

    rxNostr.dispose();
  }, 10_000);

  it('SG24: an EOSE is attributed to a leg, so nobody else’s ends this backlog', async () => {
    // **The attribution `SC16` and `SC17` measure from the *relay* side, asked
    // from the subscription side.** Those two vary which relay the EOSE comes
    // from; both send it under this request's own backward id, so neither can
    // see a machine that took *any* EOSE for its backlog. Measured: with the
    // leg test on this branch deleted, the whole of `relaykey`, `machine` and
    // `parity-answer` stayed green.
    //
    // Two foreign ids, both **well-formed and mintable**, which is the point —
    // a malformed one is refused by the `startsWith` either way:
    //
    // - another request's backward subscription on the same client, which is
    //   the ordinary case of two hooks over one relay;
    // - **this** request's forward id, which is the sharper one: it is ours,
    //   and it is not the leg that ends the backlog.
    const url = nextHost();
    const server = new WS(url, { jsonProtocol: true });
    const rxNostr = client();
    const scope = createRelayScope(rxNostr, [url]);
    const ac = new AbortController();
    const stream = referenceStream({
      verifyEvent: acceptAnyEvent,
      transport: permanentTransport(rxNostr),
      targets: requestTargets(permanentTransport(rxNostr), scope.current),
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'sc24',
      signal: ac.signal,
      timeoutMs: 400
    });

    const done = collect(stream);
    await server.connected;
    const mine = String(((await server.nextMessage) as unknown[])[1]);
    // The premise: the id this request is really listening for, so the two
    // below are foreign by comparison with something rather than by assertion.
    expect(mine.startsWith('sc24-b:'), mine).toBe(true);

    server.send(['EOSE', 'sc24other-b:0']);
    server.send(['EOSE', 'sc24-f:0']);

    expect(endsOf(await done), 'somebody else’s EOSE is not this backlog ending').toEqual([
      { kind: 'incomplete', causes: ['timeout'], error: undefined }
    ]);

    // **The control, and it is the same relay and the same socket**: this
    // request's own backward id does end it, so the arm above is not passing
    // because nothing can end a backlog here.
    const second = referenceStream({
      verifyEvent: acceptAnyEvent,
      transport: permanentTransport(rxNostr),
      targets: requestTargets(permanentTransport(rxNostr), scope.current),
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'sc24b',
      signal: ac.signal,
      timeoutMs: 3000
    });
    const ended = collect(second);
    // Read past the first request's `CLOSE`, which is in this queue too: taking
    // whatever came next echoed a subscription that had already finished and
    // the control timed out — which looked exactly like the defect this arm is
    // about.
    let asked = '';
    for (let i = 0; i < 10 && !asked.startsWith('sc24b-b:'); i += 1) {
      const message = (await server.nextMessage) as unknown[];
      if (message[0] === 'REQ') asked = String(message[1]);
    }
    expect(asked.startsWith('sc24b-b:'), asked).toBe(true);
    server.send(['EOSE', asked]);
    expect(endsOf(await ended)).toEqual([{ kind: 'complete' }]);

    rxNostr.dispose();
  }, 15_000);

  it('SG22: a doubly-escaped query is refused, and neither candidate relay is ever dialled', async () => {
    // **This asserted the opposite one round ago, twice, and both times the
    // assertion followed the implementation rather than the transport.** First
    // it recorded `?x=%257E` as a characterization of a defect; then
    // `canonicalUrl` was made to iterate to the transport's fixed point and it
    // became a success contract — a full backlog settling `complete` under the
    // name `?x=~`.
    //
    // `?x=~` is not the relay the caller wrote. The transport, given
    // `?x=%257E`, opens `?x=%7E`; it is only when *that* is handed back that it
    // opens `?x=~`. Converging therefore chose an endpoint, and this test
    // certified the choice. `SC21` measures the sharpest form of the same move
    // — `?x=%2526y=1` gains a query parameter on the second pass — and the
    // decision v1 takes is to refuse instead.
    //
    // So what is observed here is the refusal reaching the wire: **no
    // connection under either candidate, and no request under either.** The
    // control for it is `SC16`, in this file and in the same shape: a relay URL
    // the transport renames *once* is accepted, dialled, and its EOSE
    // attributed. Without that pair, "nothing was dialled" is what a blind
    // instrument also reports.
    const host = nextHost();
    const asked = `${host}/?x=%257E`;

    // The two candidates, from the resolved transport rather than from this
    // library. `onePass` is what it names the caller's URL; `settled` is what
    // it names *that*, which is where the withdrawn design pointed the socket.
    const probe = client();
    probe.setDefaultRelays([asked]);
    const onePass = Object.keys(probe.getAllRelayStatus())[0] as string;
    probe.dispose();
    const probeAgain = client();
    probeAgain.setDefaultRelays([onePass]);
    const settled = Object.keys(probeAgain.getAllRelayStatus())[0] as string;
    probeAgain.dispose();
    // The premise: these are two different relays, which is the whole reason
    // there is a decision to take.
    expect(onePass).toBe(`${host}/?x=%7E`);
    expect(settled).toBe(`${host}/?x=~`);
    expect(settled).not.toBe(onePass);

    // A socket standing where the connection would land, so "not dialled" is
    // measured against something that would have noticed. **One socket covers
    // both candidates**: mock-socket's bridge registers a server by origin, so
    // a client opening either spelling arrives here — measured, and measured
    // again at the end of this test rather than taken on trust.
    const standing = new WS(onePass, { jsonProtocol: true });

    const rxNostr = client();
    expect(() => createRelayScope(rxNostr, [asked])).toThrow(NonIdempotentRelayUrlError);

    // No scope value exists, so there is no `scope.urls` for `requestTargets`
    // to resolve, no descriptor to key a cache entry by and no `referenceStream`
    // to open — the refusal is upstream of all three. What can be observed
    // directly is that the transport was never configured, and that is the
    // observation that separates this from an implementation which writes the
    // list through and complains afterwards.
    expect(rxNostr.getDefaultRelays()).toEqual({});
    expect(rxNostr.getAllRelayStatus()).toEqual({});

    // And nothing arrives. The wait is what makes this a measurement: a
    // connection rx-nostr opens lazily would land inside it.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(standing.server.clients()).toEqual([]);
    expect(standing.messages).toEqual([]);

    rxNostr.dispose();

    // **The positive control, and it is the withdrawn design run on purpose.**
    // `settled` is what iterating to the transport's fixed point produced, and
    // it is a URL the transport does leave alone — so the scope accepts it, the
    // request goes out, and it arrives *here*, at a socket the caller never
    // named. Two things at once: the instrument above is live, and what it
    // would have caught is a request to another endpoint rather than a
    // differently-spelled one.
    const control = client();
    const controlScope = createRelayScope(control, [settled]);
    const ac = new AbortController();
    const done = collect(
      referenceStream({
        verifyEvent: acceptAnyEvent,
        transport: permanentTransport(control),
        targets: requestTargets(permanentTransport(control), controlScope.current),
        filters: [{ kinds: [1] }],
        live: false,
        reqIdBase: 'sc22',
        signal: ac.signal,
        timeoutMs: 3000
      })
    );
    await standing.connected;
    standing.send(['EOSE', String(((await standing.nextMessage) as unknown[])[1])]);
    expect(endsOf(await done)).toEqual([{ kind: 'complete' }]);
    expect(standing.server.clients().length).toBe(1);

    control.dispose();
  }, 10_000);

  it('SG19: a request with no scope attributes its EOSE, with no escape involved', async () => {
    // **The same root, outside `canonicalUrl`'s reach until now, and reachable
    // without a percent-escape at all.** `requestTargets` has a second branch —
    // a **spike-only internal fallback**, not a consumer's path: `scope` is
    // optional on `UseStreamedReqOpts` because this spike drives the engine
    // directly, so an internal caller who supplies a client and no scope gets
    // the machine's targets from `getDefaultRelays()`. rx-nostr rebuilds that
    // record from each config's own `url` field and never normalizes it
    // (`SEN25`), so the targets were that caller's spelling while `packet.from`
    // carried the client's.
    //
    // Nothing a published consumer can do reaches this: `ReqDescriptor` carries
    // neither a client nor a scope (`public-entry.ts`), and the provider's
    // scope is not optional. `roles.ts` classifies this and `SC20` as
    // regression tests for the spike's own code for that reason, and the two
    // stay live because the branch does.
    //
    // A **trailing slash** is the whole of the difference here. `ws://host/`
    // and `ws://host` are one relay to the client and were two to the machine,
    // so this needs none of the escaping `SC16` is about — which is what says
    // the defect was never a query-decoding bug. (`SC18` stood beside `SC16`
    // here and is gone: the doubly-escaped query it drove is refused now rather
    // than settled, by `canonicalUrl`'s fixed-point test, and `TD5` is where
    // that is measured. The citation outlived the arm.)
    //
    // No scope is passed, deliberately: that is the branch under test, and
    // passing one would route around it.
    const host = nextHost();
    const asked = `${host}/`;
    const rxNostr = client();
    rxNostr.setDefaultRelays([asked]);

    const targets = requestTargets(permanentTransport(rxNostr), undefined);
    const connected = Object.keys(rxNostr.getAllRelayStatus())[0] as string;
    // The premise: the client's own two accessors disagree about this relay.
    // Without this the test could pass on a client that never rewrote anything.
    expect(Object.values(rxNostr.getDefaultRelays()).map((relay) => relay.url)).toEqual([asked]);
    expect(connected).toBe(host);
    expect(connected).not.toBe(asked);

    const server = new WS(connected, { jsonProtocol: true });
    const ac = new AbortController();
    const stream = referenceStream({
      verifyEvent: acceptAnyEvent,
      transport: permanentTransport(rxNostr),
      targets,
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'sc19',
      signal: ac.signal,
      timeoutMs: 3000
    });

    const done = collect(stream);
    await server.connected;
    server.send(['EOSE', String(((await server.nextMessage) as unknown[])[1])]);

    expect(endsOf(await done)).toEqual([{ kind: 'complete' }]);

    // After the outcome, for the reason `TD5` gives — `SC18` carried it until
    // the doubly-escaped query became a refusal: the targets following the
    // client rather than the caller is this claim in the key's vocabulary, and
    // asserting it first would leave the answer above unmeasured whenever the
    // branch regresses.
    expect(targets).toEqual([connected]);

    rxNostr.dispose();
  }, 10_000);

  it('SG20: the scope-less wiring reports a timeout when the relay says nothing', async () => {
    // `SC19`'s control, and it is a separate one from `SC17` because the wiring
    // is what differs: these targets come from `getDefaultRelays()` rather than
    // from a scope. Reusing `SC17` would leave "this arm can say incomplete"
    // asserted about the other branch.
    const host = nextHost();
    const rxNostr = client();
    rxNostr.setDefaultRelays([`${host}/`]);
    const targets = requestTargets(permanentTransport(rxNostr), undefined);
    const server = new WS(Object.keys(rxNostr.getAllRelayStatus())[0] as string, {
      jsonProtocol: true
    });
    const ac = new AbortController();
    const stream = referenceStream({
      verifyEvent: acceptAnyEvent,
      transport: permanentTransport(rxNostr),
      targets,
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'sc20',
      signal: ac.signal,
      timeoutMs: 150
    });

    const done = collect(stream);
    await server.connected;
    await server.nextMessage;

    expect(endsOf(await done)).toEqual([
      { kind: 'incomplete', causes: ['timeout'], error: undefined }
    ]);

    rxNostr.dispose();
  }, 10_000);
});
