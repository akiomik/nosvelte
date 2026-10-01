/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What this design assumes rx-nostr does, asked of rx-nostr.
 */
import { WebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import type { ConnectionState } from 'rx-nostr';
import type { IWebSocketConstructor } from 'rx-nostr';
import { createRxForwardReq, createRxNostr, createRxOneshotReq, isFiltered } from 'rx-nostr';
import { afterEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

// `relay-dependency.js`, never `relay.js`: the harness is split so that this
// import reaches `rx-nostr` and `mock-socket` and stops there. `relay.js` adds
// two members that read `$lib`, and importing it from here would execute a
// library module before the first sentinel ran — which is what it did until
// `DS0` learned to follow the graph rather than the spelling.
import { createTestRelay, fakeEvent } from './relay-dependency.js';

let port = 9500;
const nextUrl = () => `ws://localhost:${(port += 1)}`;
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const websocketCtor = WebSocket as unknown as IWebSocketConstructor;

afterEach(() => WS.clean());

describe('rx-nostr, exercised directly', () => {
  // @contracts A5-S1
  it('DS1: a relay refusing a subscription neither errors nor completes it', async () => {
    // The whole reason a refusal has to be recovered from the message channel:
    // if this ever completed the subscription, the fifth event would be
    // unnecessary and the machinery around it would be dead weight.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const seen: string[] = [];
    const req = createRxForwardReq('sen1');
    rxNostr.use(req).subscribe({
      next: () => seen.push('next'),
      error: () => seen.push('error'),
      complete: () => seen.push('complete')
    });
    req.emit([{ kinds: [1] }]);
    await server.connected;
    const message = (await server.nextMessage) as [string, string];
    server.send(['CLOSED', message[1], 'blocked: no']);
    await settle(120);

    expect(seen).toEqual([]);
    rxNostr.dispose();
  });

  it('DS2: a CLOSED reaches the message channel after it has ended the subscription', async () => {
    // The ordering the fifth event's implementation depends on. A stream that
    // stops at its own end signal drops the refusal explaining that end, which
    // is what the first implementation did.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const order: string[] = [];
    rxNostr.createAllMessageObservable().subscribe((packet) => {
      if (packet.type === 'CLOSED') order.push('channel');
    });
    const req = createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen2' });
    rxNostr.use(req).subscribe({ complete: () => order.push('completed') });
    await server.connected;
    await server.nextMessage;
    server.send(['CLOSED', 'sen2:0', 'auth-required: x']);
    await settle(120);

    expect(order).toEqual(['completed', 'channel']);
    rxNostr.dispose();
  });

  // @contracts B4-S1
  it('DS3: ids and authors are matched by prefix locally, and exactly by relays', async () => {
    // Why prefixes are refused at the boundary: the local matcher accepts one
    // and a relay does not, so a prefix filter accepts events that never come.
    const full = 'a'.repeat(64);
    const event: Nostr.Event = fakeEvent({ id: full, pubkey: full, kind: 1 });

    expect(isFiltered(event, { ids: [full.slice(0, 8)] })).toBe(true);
    expect(isFiltered(event, { authors: [full.slice(0, 8)] })).toBe(true);
    expect(isFiltered(event, { ids: [full] })).toBe(true);
  });

  // @contracts B7b-S1
  it('DS4: an event already expired on arrival is dropped before use() emits', async () => {
    // What the dependency does, and what this library therefore turns *off*.
    // The comment here has been wrong twice. It first said this line was "the
    // whole of this library's NIP-40 behaviour", which `EX4` disproved; then it
    // said it was the arrival half, which stopped being true when B7b took the
    // dependency's gate off. `createNostrContext` sets
    // `skipExpirationCheck: true`, so this measurement is about the dependency's
    // capability and about what a consumer of rx-nostr *without* this library
    // would get — which is why it stays a sentinel rather than being deleted. Asked of `use()` directly, and compared against the same
    // event on the raw message channel, so "dropped" is distinguishable from
    // "never sent".
    const { rxNostr, server } = createTestRelay(nextUrl(), { skipExpirationCheck: false });
    const fromUse: string[] = [];
    const fromChannel: string[] = [];
    rxNostr.createAllMessageObservable().subscribe((packet) => {
      if (packet.type === 'EVENT') fromChannel.push(packet.event.id);
    });
    const req = createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen4' });
    rxNostr.use(req).subscribe({ next: (packet) => fromUse.push(packet.event.id) });
    await server.connected;
    await server.nextMessage;
    server.send([
      'EVENT',
      'sen4:0',
      fakeEvent({ id: 'sen4-expired', kind: 1, tags: [['expiration', '1']] })
    ]);
    server.send(['EVENT', 'sen4:0', fakeEvent({ id: 'sen4-live', kind: 1 })]);
    await settle(150);

    expect(fromChannel).toEqual(['sen4-expired', 'sen4-live']);
    expect(fromUse).toEqual(['sen4-live']);
    rxNostr.dispose();
  });

  // @contracts A5-S2
  it('DS5: a reconnect re-sends ongoing requests under the same subscription id', async () => {
    const url = nextUrl();
    const { rxNostr, server } = createTestRelay(url);
    const req = createRxForwardReq('sen5');
    rxNostr.use(req).subscribe({});
    req.emit([{ kinds: [1] }]);
    await server.connected;
    const first = String(((await server.nextMessage) as unknown[])[1]);

    server.error({ code: 1006, reason: 'gone', wasClean: false });
    await settle(120);
    const revived = new WS(url, { jsonProtocol: true });
    rxNostr.reconnect(url);
    await settle(250);

    expect(
      (revived.messages as unknown[][]).filter((m) => m[0] === 'REQ').map((m) => String(m[1]))
    ).toEqual([first]);
    rxNostr.dispose();
  });

  // @contracts C-δ-S1
  it('DS6: the relay status map is filled when the relay list is set', async () => {
    // What makes a complete diagnostics map available on the first read rather
    // than assembled over time.
    const a = nextUrl();
    const b = nextUrl();
    const { rxNostr } = createTestRelay(a);
    rxNostr.setDefaultRelays([a, b]);

    expect(rxNostr.getAllRelayStatus()).toEqual({
      [a]: { connection: 'initialized' },
      [b]: { connection: 'initialized' }
    });
    rxNostr.dispose();
  });

  // @contracts A5-S5
  it('DS12: an EOSE reaches the message channel naming the relay that sent it', async () => {
    // What a per-relay backward table rests on. The machine already recovers
    // `CLOSED` from this channel, so the shape was expected — but "the packet
    // probably has a `from`" is not a measurement, and a backward leg that
    // cannot attribute an EOSE to a relay cannot tell "one relay finished" from
    // "every relay finished".
    //
    // Two relays, one answering and one silent, because a single relay makes
    // `from` unfalsifiable: any string would look right.
    const a = nextUrl();
    const b = nextUrl();
    const { rxNostr, server: serverA } = createTestRelay(a);
    const serverB = new WS(b, { jsonProtocol: true });
    rxNostr.setDefaultRelays([a, b]);
    const eoses: string[] = [];
    rxNostr.createAllMessageObservable().subscribe((packet) => {
      if (packet.type === 'EOSE') eoses.push(`${packet.from} ${packet.subId}`);
    });
    const req = createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen12' });
    rxNostr.use(req).subscribe({});
    await serverA.connected;
    await serverB.connected;
    const subId = String(((await serverA.nextMessage) as unknown[])[1]);
    serverA.send(['EOSE', subId]);
    await settle(120);

    // Only the relay that sent one, and it names itself. The subId is the same
    // composed `<rxReqId>:<n>` the outgoing REQ carried, which is what makes it
    // attributable to a leg.
    expect(eoses).toEqual([`${a} ${subId}`]);
    expect(subId.startsWith('sen12:')).toBe(true);
    rxNostr.dispose();
  });

  // @contracts A5-S6
  it('DS13: a backward request whose every relay is down completes, and does not error', async () => {
    // Why an `error` handler is not the fix for a backward transport failure.
    // rx-nostr completes the backward observable once every target connection is
    // `error` / `rejected` / `terminated` (3.7.5), so a leg that reached nobody
    // arrives as a completion indistinguishable — on the subscription alone —
    // from one that heard EOSE from everybody. The connection-state channel is
    // the only place the difference exists.
    //
    // Retries are off in this harness, so one socket failure reaches `error`
    // directly. Under production defaults the same state is reached when the
    // retries run out.
    const url = nextUrl();
    const { rxNostr, server } = createTestRelay(url);
    const seen: string[] = [];
    const states: string[] = [];
    rxNostr.createConnectionStateObservable().subscribe((packet) => states.push(packet.state));
    const req = createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen13' });
    rxNostr.use(req).subscribe({
      next: () => seen.push('next'),
      error: () => seen.push('error'),
      complete: () => seen.push('complete')
    });
    await server.connected;
    await server.nextMessage;
    // No EOSE and no CLOSED: the socket dies with the request outstanding.
    server.error({ code: 1006, reason: 'gone', wasClean: false });
    await settle(200);

    expect(seen).toEqual(['complete']);
    expect(states).toContain('error');
    rxNostr.dispose();
  });

  // @contracts A-γ-S1
  it('DS14: rx-nostr completes a backward request on its own eoseTimeout', async () => {
    // The second timer this library has to keep out of the way of. The request
    // owns its settle timeout (A-γ), and that claim is false whenever the
    // upstream one fires first: this completes the observable with no EOSE, no
    // CLOSED and no connection-state change, so it is indistinguishable at the
    // subscription from a clean finish.
    //
    // Measured at 40ms rather than at the 30s default, because a sentinel that
    // waits out the default is a sentinel nobody runs. What the default *is*
    // does not matter to this library once it sets the option itself; what
    // matters is that the option is honoured, which is this.
    const url = nextUrl();
    const { rxNostr, server } = createTestRelay(url, { eoseTimeout: 40 });
    const seen: string[] = [];
    rxNostr.use(createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen14' })).subscribe({
      error: () => seen.push('error'),
      complete: () => seen.push('complete')
    });
    await server.connected;
    await server.nextMessage;
    await settle(150);

    expect(seen).toEqual(['complete']);
    rxNostr.dispose();
  });

  // @contracts A5-S3
  it('DS9: a relay advertising a subscription cap makes rx-nostr queue, not refuse', async () => {
    // Asked of the client rather than of a request built on it: the wrapper's
    // behaviour under a cap is our contract, and this is the dependency rule
    // underneath it.
    const { Nip11Registry, createRxOneshotReq: oneshot } = await import('rx-nostr');
    const url = nextUrl();
    Nip11Registry.set(url, { limitation: { max_subscriptions: 1 } });
    const { rxNostr, server } = createTestRelay(url);
    rxNostr.setDefaultRelays([url]);

    rxNostr.use(oneshot({ filters: [{ kinds: [1] }], rxReqId: 'sen9a' })).subscribe({});
    rxNostr.use(oneshot({ filters: [{ kinds: [7] }], rxReqId: 'sen9b' })).subscribe({});
    await server.connected;
    await settle(250);

    const reqs = (server.messages as unknown[][]).filter((m) => m[0] === 'REQ');
    // One sent, one held. Not refused: nothing on the error channel and no
    // CLOSED, which is why a request under a cap looks like a slow one.
    expect(reqs).toHaveLength(1);

    rxNostr.dispose();
  });

  // @contracts B3-S1
  it('DS17: use() routes a request to a named relay set, defaults or not', async () => {
    // Whether the dependency can express "ask these relays" at all. Without it,
    // B3 stops at the cache key: the scope decides which entry an answer lands
    // in while the REQ goes wherever the client's defaults point when it is
    // sent, so a client that moved between the two puts one scope's answers
    // under another's key. Measured before designing around it, because "it
    // probably supports this" is how a fix gets written for an API that is not
    // there.
    //
    // Two things at once, and both are load bearing. The named relay is asked
    // even though it is not a default — so a request can outlive a scope change
    // — and the default that was *not* named is not asked, which is the half
    // that makes the routing a set rather than an addition.
    const named = nextUrl();
    const defaulted = nextUrl();
    const namedServer = new WS(named, { jsonProtocol: true });
    const { rxNostr, server: defaultServer } = createTestRelay(defaulted);
    rxNostr.setDefaultRelays([defaulted]);

    rxNostr
      .use(createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen17' }), {
        on: { relays: [named] }
      })
      .subscribe({});
    await namedServer.connected;
    await settle(150);

    const reqsTo = (server: WS) =>
      (server.messages as unknown[][]).filter((m) => m[0] === 'REQ').map((m) => String(m[1]));
    expect(reqsTo(namedServer)).toEqual(['sen17:0']);
    expect(reqsTo(defaultServer)).toEqual([]);

    rxNostr.dispose();
  });

  // @contracts B3-S2
  it('DS18: a named request is not re-issued to a relay added to the defaults later', async () => {
    // The cost of DS17's routing, and the reason it is a cost worth paying
    // here. rx-nostr keeps its *default* subscriptions and re-subscribes each of
    // them on every relay added to the default set afterwards; a request routed
    // to named relays is `temporary` and gets none of that.
    //
    // Both halves are measured, because "the named one was not re-issued" means
    // nothing without the default one being re-issued in the same run — that is
    // what distinguishes the behaviour from the relay simply never being asked
    // by anybody.
    const first = nextUrl();
    const added = nextUrl();
    const { rxNostr, server: firstServer } = createTestRelay(first);
    rxNostr.setDefaultRelays([first]);

    const defaultReq = createRxForwardReq('sen18-default');
    rxNostr.use(defaultReq).subscribe({});
    defaultReq.emit([{ kinds: [1] }]);
    const namedReq = createRxForwardReq('sen18-named');
    rxNostr.use(namedReq, { on: { relays: [first] } }).subscribe({});
    namedReq.emit([{ kinds: [1] }]);
    await firstServer.connected;
    await settle(120);

    const addedServer = new WS(added, { jsonProtocol: true });
    rxNostr.setDefaultRelays([first, added]);
    await addedServer.connected;
    await settle(200);

    const ids = (addedServer.messages as unknown[][])
      .filter((m) => m[0] === 'REQ')
      .map((m) => String(m[1]));
    expect(ids.some((id) => id.startsWith('sen18-default:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('sen18-named:'))).toBe(false);

    rxNostr.dispose();
  });
  // @contracts C-δ-S2
  it('DS19: a relay dropped from the defaults keeps its status entry', async () => {
    // The other side of DS6, and the reason the relay diagnostics can fall back
    // to `initialized` without that fallback ever being reached. The map is
    // built from the *scope* now, so the gap the fallback covers is a scope
    // relay the client has no status for — and the only way to approach it is a
    // client changed behind the scope's back. Even then the client keeps what it
    // had: removing a relay from the default list does not remove it from
    // `getAllRelayStatus()`.
    //
    // Measured rather than assumed, because a comment in the store rests on it:
    // if this ever changed, the fallback would become reachable and would start
    // reporting a socket state for a relay whose socket the client has forgotten.
    const kept = nextUrl();
    const dropped = nextUrl();
    const { rxNostr } = createTestRelay(kept);
    new WS(dropped, { jsonProtocol: true });
    rxNostr.setDefaultRelays([kept, dropped]);

    expect(Object.keys(rxNostr.getAllRelayStatus()).sort()).toEqual([kept, dropped].sort());

    rxNostr.setDefaultRelays([kept]);
    await settle(80);

    // Still there, and still saying nothing has happened to it.
    expect(rxNostr.getAllRelayStatus()[dropped]).toEqual({ connection: 'initialized' });
    // And the list itself did move, which is what says the removal happened at
    // all rather than the call being ignored.
    expect(Object.keys(rxNostr.getDefaultRelays())).toEqual([kept]);

    rxNostr.dispose();
  });

  // `B-α-C9` is measured by this arm, `DS26` and `DS27` together, and a roster
  // line can credit one test only, so the row stays `TBD` until one arm carries
  // all three clauses rather than being credited to the first of them.
  it('DS25: the client rewrites a relay URL, and its own relay list does not say so', async () => {
    // The spelling this library has to match, taken from the client rather than
    // read off the dependency's source.
    //
    // rx-nostr normalizes a relay URL before it connects and keys its
    // connections by the result (`UrlMap`, `NostrConnection`), but
    // `normalizeRelayUrl` is not on its public surface — `import
    // { normalizeRelayUrl } from 'rx-nostr'` does not resolve — so this library
    // writes the transformation out a second time and the two can drift. They
    // had: the query decode below was missing here, and the consequence was not
    // cosmetic, because the machine's per-relay backward table is keyed by our
    // spelling while `packet.from` carries the client's. `SC15` is where the two
    // are compared; this is the half that can be taken without our code.
    //
    // These were taken at rx-nostr 3.7.5 on the spike and re-run at 3.7.6, the
    // version `DS10` pins here. Nothing here reads a second dependency, so it
    // needs no version record of its own.
    //
    // No relay listed here is connected to — the default connection strategy is
    // lazy, and `getAllRelayStatus()` reports `initialized` — so the hosts are
    // literals rather than ports. A client each, because several of these
    // normalize onto the same key and one client would silently merge them.
    const CASES: readonly (readonly [string, string])[] = [
      // The two the query decode is about: an escape rx-nostr resolves and this
      // library used to keep.
      ['wss://h.example/?x=%7E', 'wss://h.example/?x=~'],
      ['wss://h.example/?x=%2F', 'wss://h.example/?x=/'],
      // A double escape is decoded exactly once, so it lands on the *first*
      // spelling rather than on `~`.
      ['wss://h.example/?x=%257E', 'wss://h.example/?x=%7E'],
      // `%20` survives as `+`, and that one is not the query decode at all: the
      // urlencoded serializer behind `searchParams.sort()` writes a space as
      // `+` before anything is decoded.
      ['wss://h.example/?x=%20', 'wss://h.example/?x=+'],
      ['wss://h.example/?x=a%2Bb', 'wss://h.example/?x=a+b'],
      // An invalid percent sequence comes back out unchanged — and getting that
      // right needs the decode, because sorting escapes the `%` to `%25` first.
      ['wss://h.example/?x=%zz', 'wss://h.example/?x=%zz'],
      // The steps this library already had, kept so that a change to any of
      // them is visible here too rather than only in `SC10`.
      ['wss://h.example/', 'wss://h.example'],
      ['wss://h.example#fragment', 'wss://h.example'],
      ['wss://h.example./', 'wss://h.example'],
      ['wss://h.example/path/', 'wss://h.example/path'],
      ['wss://h.example/%7Epath', 'wss://h.example/~path'],
      ['wss://h.example/?b=2&a=1', 'wss://h.example/?a=1&b=2'],
      ['  wss://h.example  ', 'wss://h.example'],
      // Not a URL at all: returned as trimmed rather than guessed at or thrown.
      ['not a url at all', 'not a url at all'],
      ['', '']
    ];

    const keys: string[] = [];
    for (const [input] of CASES) {
      const client = createRxNostr({ websocketCtor, skipVerify: true, skipFetchNip11: true });
      client.setDefaultRelays([input]);
      keys.push(Object.keys(client.getAllRelayStatus())[0] as string);
      client.dispose();
    }
    expect(keys).toEqual(CASES.map(([, spelling]) => spelling));
    // Not a client that echoes its input back: the corpus has to contain at
    // least one URL the client rewrote, or the list above says nothing about
    // normalization at all.
    expect(keys).not.toEqual(CASES.map(([input]) => input));

    // **The client's two accessors disagree about the same relay**, and that is
    // why a list-versus-list comparison cannot notice a normalizer divergence.
    // `getAllRelayStatus()` is keyed by `NostrConnection.url`, which is
    // normalized; `getDefaultRelays()` rebuilds its record from each config's
    // own `url` field, which is the string the caller passed. So the caller's
    // spelling is echoed back on one accessor and rewritten on the other.
    const both = createRxNostr({ websocketCtor, skipVerify: true, skipFetchNip11: true });
    both.setDefaultRelays([{ url: 'wss://h.example/?x=%7E', read: true, write: true }]);
    expect(Object.keys(both.getAllRelayStatus())).toEqual(['wss://h.example/?x=~']);
    expect(Object.keys(both.getDefaultRelays())).toEqual(['wss://h.example/?x=%7E']);
    expect(Object.values(both.getDefaultRelays()).map((relay) => relay.url)).toEqual([
      'wss://h.example/?x=%7E'
    ]);
    both.dispose();

    // And the rewritten spelling is the one that comes back on a packet, which
    // is the form the machine attributes an EOSE by. Asked on the wire rather
    // than inferred from the status map, because `advanceBackward` is handed
    // `packet.from` and nothing else.
    const asked = `${nextUrl()}/?x=%7E`;
    const connected = asked.replace('%7E', '~');
    const server = new WS(connected, { jsonProtocol: true });
    const rxNostr = createRxNostr({
      websocketCtor,
      skipVerify: true,
      skipFetchNip11: true,
      retry: { strategy: 'off' }
    });
    rxNostr.setDefaultRelays([asked]);
    const froms: string[] = [];
    rxNostr.createAllMessageObservable().subscribe((packet) => {
      if (packet.type === 'EOSE') froms.push(packet.from);
    });
    rxNostr.use(createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen25' })).subscribe({});
    await server.connected;
    server.send(['EOSE', String(((await server.nextMessage) as unknown[])[1])]);
    await settle(120);

    // Named by the spelling the client chose, not by the one it was given.
    expect(froms).toEqual([connected]);
    expect(froms).not.toEqual([asked]);
    rxNostr.dispose();
  });

  // Part of `B-α-C9`'s measurement, with `DS25` — see there.
  it('DS27: naming a relay is not dialling it, which is what makes a probe cheap', async () => {
    // The premise the transport-key comparison rests on. That check asks the
    // resolved transport what it calls a set of relays by configuring a
    // throwaway client and reading its connection keys — and that is only a
    // reasonable thing to do on every published scope generation if configuring
    // a client costs no sockets.
    //
    // **The library would still be correct if this stopped being true, and that
    // is exactly why it needs a sentinel.** An eager transport would make every
    // provider construction and every relay-list change open a full set of
    // connections and tear them down again, on the caller's synchronous path.
    // Nothing in the library's own tests would fail; the network would just be
    // dialled twice for every relay, and a relay operator would see it before
    // this repository did.
    const dialled = nextUrl();
    const server = new WS(dialled, { jsonProtocol: true });
    const client = createRxNostr({ websocketCtor, skipVerify: true, skipFetchNip11: true });

    client.setDefaultRelays([dialled]);
    // The key is readable at once — the other half of what makes a probe work,
    // and `RD6` is where the library depends on it.
    expect(Object.keys(client.getAllRelayStatus())).toEqual([dialled]);
    await settle(200);

    // Named, and not dialled.
    expect(server.server.clients()).toEqual([]);

    // **The control**, because "no socket appeared" is also what a broken
    // fixture reports. The same client, the same relay, one REQ: now it dials.
    // Without this the assertion above would pass against a mock server that
    // could never have seen anything.
    const req = createRxForwardReq('sen27');
    client.use(req).subscribe({ error: () => undefined });
    req.emit([{ kinds: [1] }]);
    await server.connected;
    expect(server.server.clients().length).toBe(1);

    // And disposal takes it away again, which is what the probe's `finally`
    // relies on.
    client.dispose();
    await settle(80);
    expect(server.server.clients()).toEqual([]);
  });

  // Part of `B-α-C9`'s measurement, with `DS25` — see there.
  it('DS26: the rewrite is not idempotent, and this is which shapes it moves twice', () => {
    // The fact the library's refusal rule rests on, taken where no `$lib` is on
    // the path (`DS0`). `DS25` records that the transport renames a relay;
    // this records that renaming it once is not always enough — feed the new
    // name back and some of them move again.
    //
    // That is what makes it a decision rather than a transcription problem.
    // The library writes its own spelling through to the client, so for these
    // inputs the name it would key a request by and the connection that answers
    // are two different relays; it refuses them rather than converging, because
    // converging picks the endpoint (see `NonIdempotentRelayUrlError`, and the
    // `%2526` row below, where the second pass changes how many query
    // parameters there are).
    //
    // **What breaks this test is the dependency, which is the point.** If
    // rx-nostr ever becomes idempotent, every case below settles, the refusal
    // refuses nothing, and this says so — before the library's own tests, which
    // would still pass with a rule that never fires.
    //
    // A client each, disposed straight away: nothing is dialled, because the
    // default connection strategy is lazy.
    const nameOf = (input: string): string => {
      const client = createRxNostr({ websocketCtor, skipVerify: true, skipFetchNip11: true });
      client.setDefaultRelays([input]);
      const named = Object.keys(client.getAllRelayStatus())[0] as string;
      client.dispose();
      return named;
    };

    const CASES = [
      'wss://h.example/?x=%7E',
      'wss://h.example/?x=%257E',
      'wss://h.example/?x=%2526y=1',
      'wss://h.example/%7Epath',
      'wss://h.example/%257Epath',
      'wss://h.example/',
      'wss://h.example//',
      'wss://h.example///',
      'wss://h.example//?a=1',
      'wss://h.example///?a=1',
      'wss://h.example./',
      'wss://h.example../',
      'wss://h.example../?x=%7E',
      'wss://h.example'
    ];

    const settled = CASES.filter((input) => nameOf(nameOf(input)) === nameOf(input));

    // The membership list rather than a boolean per case, so a shape that
    // changes class names itself in the failure rather than turning one `true`
    // into a `false`. The split is the whole content: one trailing slash, two
    // trailing slashes and one trailing hostname dot survive a single pass;
    // three slashes, two dots and any doubly-escaped sequence do not.
    expect(settled).toEqual([
      'wss://h.example/?x=%7E',
      'wss://h.example/%7Epath',
      'wss://h.example/',
      'wss://h.example//',
      'wss://h.example//?a=1',
      'wss://h.example./',
      'wss://h.example'
    ]);
    // Not vacuous in either direction: both classes are inhabited, so a client
    // that rewrote everything or nothing fails here rather than passing one of
    // the two assertions above by emptiness.
    expect(settled.length).toBeGreaterThan(0);
    expect(settled.length).toBeLessThan(CASES.length);

    // And the second pass is a different request, not a tidier spelling of the
    // same one. One query parameter becomes two, which a relay that
    // authenticates or routes on its query reads as something else entirely.
    const once = nameOf('wss://h.example/?x=%2526y=1');
    expect([...new URL(once).searchParams]).toEqual([['x', '&y=1']]);
    expect([...new URL(nameOf(once)).searchParams]).toEqual([
      ['x', ''],
      ['y', '1']
    ]);
  });
});

describe("rx-nostr's own vocabulary, as a set", () => {
  // @contracts C-δ-S3
  it('DS20: ConnectionState is exactly the nine states the records reason about', () => {
    // Measured against the dependency alone, because the library's own
    // `RelayConnection` re-declares these nine names and the point of
    // re-declaring is that rx-nostr's type is not on our published surface.
    // The two halves have to be checkable without either importing the other:
    // this is the dependency's half, and `LK11` is ours.
    //
    // 0002 decides what `dormant`, `rejected` and `terminated` mean for a leg by
    // these names, and `phaseOfConnectionState` maps all nine, so a state added
    // upstream is a state with no decision about it. The failure this must
    // produce is loud rather than a widened union nobody reads.
    const NINE = [
      'initialized',
      'connecting',
      'connected',
      'waiting-for-retrying',
      'retrying',
      'dormant',
      'error',
      'rejected',
      'terminated'
    ] as const;

    // Assignable in both directions, so a member added or removed upstream is a
    // type error here rather than a silent difference. `npm run check` is what
    // fails; the runtime assertion below keeps the names visible in a diff.
    const _fromDependency: (typeof NINE)[number] = null as unknown as ConnectionState;
    const _toDependency: ConnectionState = null as unknown as (typeof NINE)[number];
    void _fromDependency;
    void _toDependency;

    expect(new Set(NINE).size).toBe(9);
  });
});

describe('the defaults this design copied into its records', () => {
  it('DS31: rx-nostr drops an event whose kind the REQ did not ask for', async () => {
    // **A dependency fact this library leans on to say a clause is
    // unreachable.** `ownEvent` refuses an event whose `kind` is not a finite
    // number, and no arm on the public path can reach that clause: the
    // descriptor boundary requires `kinds`, and rx-nostr matches every event
    // against the REQ's filters before a subscriber sees it. That second half
    // is measured here rather than remembered — **if it ever stops, the clause
    // becomes reachable and this arm is what says so**, rather than a comment
    // in a test that has quietly become false.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const seen: string[] = [];
    const req = createRxForwardReq('sen26');
    rxNostr.use(req).subscribe({ next: (packet) => seen.push(String(packet.event.id)) });
    req.emit([{ kinds: [1] }]);
    await server.connected;
    const message = (await server.nextMessage) as [string, string];

    // A kind that is not in the filter, then a kind that is, then a `kind` that
    // is not a number at all — the shape the library's own check exists for.
    server.send(['EVENT', message[1], fakeEvent({ id: 'wrong-kind', kind: 7 })]);
    server.send(['EVENT', message[1], fakeEvent({ id: 'right-kind', kind: 1 })]);
    server.send([
      'EVENT',
      message[1],
      { ...fakeEvent({ id: 'string-kind' }), kind: '1' } as unknown as Nostr.Event
    ]);
    await settle();

    // Only the one the REQ asked for. The other two never reach a subscriber,
    // which is what makes `ownEvent`'s `kind` clause unreachable from a request.
    expect(seen).toEqual(['right-kind']);

    rxNostr.dispose();
  });

  // @contracts A5-S7
  it('DS23: rx-nostr reconnects a dropped socket on its own, about a second later', async () => {
    // **A5-C4 and 0004 both state this policy as a literal, transcribed by
    // hand, and nothing pinned it.** An upstream change would have turned a
    // shipping-policy claim into a test-only one silently: the records would go
    // on saying "a relay that drops off is `recovering` because rx-nostr
    // reconnects on its own" while the dependency did something else, and every
    // witness would still pass, because the suite sets `retry: 'off'` almost
    // everywhere and the two reconnection tests drive `reconnect()` by hand.
    //
    // Observed rather than read off the config object, because what the records
    // depend on is the behaviour. The delay is checked loosely — that it is not
    // immediate, and that it happens — since the claim A5 rests on is "it comes
    // back without being asked", not the exact curve.
    const url = nextUrl();
    const server = new WS(url, { jsonProtocol: true });
    // No `retry` at all: the dependency's default is the subject.
    const rxNostr = createRxNostr({
      websocketCtor,
      skipVerify: true,
      skipFetchNip11: true
    });
    try {
      rxNostr.setDefaultRelays([url]);
      const req = createRxForwardReq('sen21');
      rxNostr.use(req).subscribe({ next: () => undefined });
      req.emit([{ kinds: [1] }]);
      await server.connected;

      const states: string[] = [];
      rxNostr.createConnectionStateObservable().subscribe((packet) => states.push(packet.state));

      server.close();
      await settle(300);
      // Not immediate: the default carries an initial delay, so nothing has
      // re-opened yet. This is the half that would break if the default became
      // "retry at once".
      expect(states).toContain('waiting-for-retrying');

      await settle(1500);
      // And it came back without anybody calling `reconnect()`.
      expect(states).toContain('retrying');
    } finally {
      rxNostr.dispose();
    }
  }, 10_000);

  // @contracts A-ε-S1
  it('DS24: a client given no verifier delivers nothing, because the default throws', async () => {
    // The other default this design reasons about, and the one that decided the
    // shape of the signature gate: absent a verifier rx-nostr is fail-closed.
    // 0004 leans on that when it explains why moving verification into the
    // library inverted the posture — if this ever became a permissive default,
    // that paragraph would describe a risk that no longer exists and the
    // library's own fail-closed check would be the only thing holding.
    const url = nextUrl();
    const server = new WS(url, { jsonProtocol: true });
    // No `verifier` and no `skipVerify`: both defaults are the subject.
    const rxNostr = createRxNostr({ websocketCtor, skipFetchNip11: true });
    try {
      rxNostr.setDefaultRelays([url]);
      const seen: string[] = [];
      const req = createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen22' });
      rxNostr
        .use(req)
        .subscribe({ next: () => seen.push('next'), error: () => seen.push('error') });

      const message = (await server.nextMessage) as [string, string, ...unknown[]];
      server.send(['EVENT', message[1], fakeEvent()]);
      await settle(200);

      expect(seen).not.toContain('next');
      // **What it did instead, which the negative alone does not say.** The
      // title claims a mechanism — the default verifier *throws* — and `seen`
      // has been collecting the evidence for it one line above without ever
      // being asked. rx-nostr's message is the one 0004 quotes when it explains
      // why moving the gate into the library inverted the posture.
      expect(seen).toContain('error');
    } finally {
      rxNostr.dispose();
    }

    // **The positive control, without which this arm cannot tell a fail-closed
    // dependency from a fixture that never delivered anything.** The same
    // construction, the same event, the same wait — with verification turned
    // off. A blind probe and a dependency that dropped the event give the same
    // empty list above; only this line says which one was measured.
    const openUrl = nextUrl();
    const openServer = new WS(openUrl, { jsonProtocol: true });
    const permissive = createRxNostr({ websocketCtor, skipFetchNip11: true, skipVerify: true });
    try {
      permissive.setDefaultRelays([openUrl]);
      const delivered: string[] = [];
      const openReq = createRxOneshotReq({ filters: [{ kinds: [1] }], rxReqId: 'sen24-control' });
      permissive
        .use(openReq)
        .subscribe({ next: () => delivered.push('next'), error: () => delivered.push('error') });

      const openMessage = (await openServer.nextMessage) as [string, string, ...unknown[]];
      openServer.send(['EVENT', openMessage[1], fakeEvent()]);
      await settle(200);

      expect(delivered, 'the same arrangement delivers when nothing is verifying').toContain(
        'next'
      );
    } finally {
      permissive.dispose();
    }
  });
});
