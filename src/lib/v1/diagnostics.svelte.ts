/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The per-relay half of the diagnostics axis, and the relay map it publishes.
 *
 * Two decisions, named directly because naming them through a third is what
 * went wrong here: the axis splits per request and per relay (C4b), and the
 * relay side is a complete map of the scope's relays held as a value, for as
 * long as the provider stands (C-δ).
 * This file is the second half of the first and the whole of the second. This
 * line used to reach both through a third id that no record carries; 0005's
 * tenth limit has that history, because `CAT18` cannot tell a retired id being
 * explained from one being relied on, and this file is inside its scope.
 *
 * The diagnostics axis has two halves and they were being discussed as one. A
 * refusal belongs to a request — `CLOSED` carries the subId that says which —
 * and rides on the cache value, where it decides a slot. Everything else a relay
 * says carries no subId at all: `NOTICE` has only a message, `OK` and `AUTH`
 * name no subscription, and a socket closing is not about a request either. That
 * half cannot be attached to a request without inventing an attribution, so it
 * is addressed per relay instead.
 *
 * That split is what makes both halves implementable. The query half is done
 * (see `ReqDiagnostics`); this is the other one, and it is also the successor to
 * `useConnections`.
 *
 * **Which relays are in the map is a third question, and it split again.** This
 * read `getDefaultRelays()`, so membership, read/write and connection state all
 * came from the client. The question left open for the review was whether the
 * axis should report the scope or the client; the answer is that it is not one
 * question:
 *
 * | Fact                            | Comes from                             |
 * | ------------------------------- | -------------------------------------- |
 * | which relays, URL, read/write   | the immutable {@link RelayScope} (B-α) |
 * | connection state, last `NOTICE` | observing the client the provider owns |
 *
 * The scope is what a consumer configured and what every request is keyed under,
 * so it is the only membership a published map can claim; the connection is a
 * fact about a socket and can only be observed. A relay that is in the client
 * and not in the scope is **neither** — it is not merged in, because there is no
 * question it is the answer to. It is an invariant violation: C6 has the
 * provider create the client so that nothing else can add one, and until then
 * `createRelayScope().hasDrifted()` is where that is observable. It gets no
 * channel of its own here, for the reason 0002 gives for `dormant`: a state that
 * cannot be reached through the published surface is recorded rather than given
 * a surface, and one that can be reached only by holding an object C6 says a
 * consumer never holds is the same case. If that ever stops being true — a
 * supported way for the client to move behind the scope — the decision to
 * revisit is that one, not this file.
 */

import type { RxNostr } from 'rx-nostr';

import type { UnixSeconds } from './clock.svelte.js';
import { getNostrContext } from './context.svelte.js';
import type { RelayMessage } from './normalize.js';
import { relayMessage } from './normalize.js';
import type { RefusalReason } from './refusal.js';
import { classifyRefusal } from './refusal.js';
import type { RelayConfigurationError, RelayScope } from './scope.svelte.js';

/**
 * What a socket is doing, in this library's own vocabulary.
 *
 * The nine names are rx-nostr's and are kept deliberately: 0002 decides what
 * `dormant`, `rejected` and `terminated` mean for a leg by those names, so
 * renaming them here would make the record and the type disagree about the same
 * fact. What is *not* kept is the dependency's declaration. `connection` was
 * typed as rx-nostr's `ConnectionState` for six rounds, which put the
 * dependency's type on the published surface — the thing 0004 states as a rule
 * for `EventPacket`, and that `LK3` and `LK4` enforced over a written-out list
 * of names: four of the query library's in one, `EventPacket` in the other. A
 * rule with per-instance enforcement catches the instance somebody thought of.
 * (This used to say both of them enforced it "for `EventPacket` alone", which is
 * `LK4`'s subject and not `LK3`'s.)
 *
 * Re-declaring costs a way for the two to drift apart, so the two declarations
 * are each pinned to the same nine names written out: `SEN20` for rx-nostr's,
 * `LK11` for this one. A dependency that adds a state fails at `SEN20`, and
 * adding it here is then a decision about what it means for a leg rather than a
 * silent widening of what this library publishes.
 *
 * **This used to say `SEN20` asserts the two are the same set in both
 * directions, and `SEN20` never sees this type.** The sentinels may not import
 * the library — that is `SEN0` — so the "both directions" it does assert are
 * between rx-nostr's union and the nine names spelled out inside that test.
 * `LK11` landed in the same commit as the sentence, so the half it names was
 * there to be named.
 */
export type RelayConnection =
  | 'initialized'
  | 'connecting'
  | 'connected'
  | 'waiting-for-retrying'
  | 'retrying'
  | 'dormant'
  | 'error'
  | 'rejected'
  | 'terminated';

/**
 * The nine, as a value, so the published field can be checked against them.
 *
 * **The type was doing no work at run time.** `getAllRelayStatus()` is the
 * dependency's answer and this library republishes `connection` from it — so a
 * transport whose state set has moved, or a stub that answers something else,
 * put `'quantum-entangled'` (and an object, measured) on a field whose type
 * names nine strings. Every *other* reader of that answer already handles the
 * unknown case: `phaseOfConnectionState` and `approachFor` both default. The
 * published field was the one place the value passed through unread.
 */
const RELAY_CONNECTIONS: ReadonlySet<string> = new Set([
  'initialized',
  'connecting',
  'connected',
  'waiting-for-retrying',
  'retrying',
  'dormant',
  'error',
  'rejected',
  'terminated'
]);

/**
 * What this library will say about a socket state it does not know.
 *
 * `'error'` rather than `'initialized'`: the two are not symmetric to a
 * consumer. "Nothing has happened yet" is the state a spinner waits on for
 * ever, and a transport answering something this library cannot read is a
 * condition somebody has to see. It is the same direction the verifier's answer
 * is read in — what cannot be understood is not treated as fine.
 */
const publishedConnection = (state: unknown): RelayConnection =>
  typeof state === 'string' && RELAY_CONNECTIONS.has(state) ? (state as RelayConnection) : 'error';

/**
 * What a torn-down provider answers: no relays, and nothing to write into.
 *
 * The same shape a live snapshot has — no prototype, frozen — because a
 * consumer holding the hook across a teardown reads *this*, and a lookup on it
 * has to answer one of the two values the type names like any other.
 */
const NO_RELAYS: RelayDiagnostics = Object.freeze(Object.create(null) as RelayDiagnostics);

/** What is known about one relay, whether or not anything has happened to it. */
export interface RelayDiagnostic {
  readonly url: string;
  /**
   * The spellings the consumer wrote that resolved to this relay.
   *
   * **The map is keyed by the transport's name and a consumer holds their own
   * string**, so `diagnostics[whatIConfigured]` came back `undefined` for a
   * trailing slash, a capitalised host or a reordered query — measured — and
   * nothing published bridged the two. This is that bridge, and it is a list
   * because two spellings can be one relay.
   *
   * **Not an index of everything ever refused**: it names the spellings in the
   * *accepted* scope. A refused update's URLs are not here, and should not be —
   * they are not relays this provider has.
   */
  readonly configuredUrls: readonly string[];
  readonly connection: RelayConnection;
  /**
   * What the accepted scope says this relay may be used for.
   *
   * **The scope's rather than the client's**, which is the same answer at every
   * state a consumer can reach and a different one under drift: `snapshot()`
   * reads `relay.read` off the scope, and `RD7` holds it by rewriting the
   * client's list behind the scope's back and reading the old capabilities
   * back out. This line said "from the client's own relay list" for several
   * rounds, which is the header table of this file inverted and the opposite of
   * what a consumer editing a relay list would predict.
   */
  readonly read: boolean;
  readonly write: boolean;
  /**
   * The last `NOTICE` this relay sent, if any.
   *
   * `NOTICE` is `["NOTICE", <message>]` — no subscription id, by NIP-01's own
   * shape (CONST-R9) — so this is the only place it can go. Today the library
   * writes it to `console.error` unconditionally, which is #85: a message with
   * nowhere to be shown becomes a message the application cannot suppress.
   *
   * **Bounded, and the type says so** — see `RelayMessage`. It was a bare
   * `string`, so a relay decided how much a provider held for as long as it was
   * in the scope; what was bounded was the *count* of refusals and never the
   * size of any of them.
   */
  readonly lastNotice: RelayMessage | undefined;
  /**
   * The last `CLOSED` observed on this relay, with when it was observed.
   *
   * **It is not "this relay is refusing everything now".** A `CLOSED` is a
   * refusal of one subscription, and a relay that refused an authenticated read
   * an hour ago may be answering ordinary reads; publishing it as a current
   * state would make a stale `auth-required` read as the connection's reason.
   * The timestamp is what lets a consumer tell those apart, which is why it is
   * here and not left to whenever a panel happened to mount.
   *
   * **Why the relay axis needs it at all, when `ReqDiagnostics.refusals` exists.**
   * That one is per request, because completion has to be attributed — and a
   * relay panel holds no requests, so the commonest reason a relay is useless to
   * a user (`auth-required:`) was unreachable from the axis whose whole job is
   * to say what each relay is doing. `C4b`'s falsifier is "a relay-level fact
   * has to be attributed to a request"; this is the half of it `lastNotice`
   * already closed for `NOTICE` and not for `CLOSED`, which is the message
   * relays actually use.
   *
   * One per relay, the same bound `RelayMessage` takes, gone when the relay
   * leaves the accepted scope and at provider teardown — the ownership rules
   * `lastNotice` established.
   */
  readonly lastRefusal: RelayRefusalDiagnostic | undefined;
}

/** The last refusal observed on a relay, on the provider's own axis. */
export interface RelayRefusalDiagnostic {
  /** The classification, from the same table a request's `Refusal` uses. */
  readonly reason: RefusalReason;
  /** What the relay said, bounded as every published relay string is. */
  readonly notice: RelayMessage;
  /**
   * When this library saw it, from the **provider's** clock, in whole seconds.
   *
   * The unit is in the name so that a port cannot pick another one and a reader
   * cannot mistake it for milliseconds; the source is the provider's clock
   * rather than `Date.now()` so that the axis has one notion of time and a test
   * can hold it still.
   */
  readonly observedAtUnixSeconds: number;
}

/**
 * Every relay, always — never a growing list.
 *
 * `useConnections()` emits one array per connection event, so a consumer
 * rendering it sees a list that fills up, and the first paint is a subset of the
 * relays with no way to tell it apart from a complete answer (#92). That is not
 * inherent: `getAllRelayStatus()` returns the whole picture synchronously, so
 * the complete map is available before anything is subscribed to.
 *
 * **The completeness is an invariant of this module, not a property of the
 * type**, and the sentence here used to claim otherwise: "there is no shape
 * that can represent some of the relays" is false of `Record<string, T>`, which
 * an empty object and a partial one both inhabit. What the type *can* say is
 * the other half — that a lookup by an arbitrary string may find nothing. It
 * says it now: the keys are the transport's names for the accepted scope's
 * relays, a finite set a consumer does not hold, and indexing with anything
 * else is `undefined`. Enumerating gives every relay in the scope, which is
 * what `RD*` measures.
 */
export type RelayDiagnostics = Readonly<Record<string, RelayDiagnostic | undefined>>;

function snapshot(
  scope: RelayScope,
  /**
   * `undefined` on a server, where the provider creates no live transport.
   *
   * **The map does not shrink for it**, and that is the shape rather than a
   * concession: membership, URL and capabilities all come from the scope, and
   * the connection state is the one fact that needs a socket to observe. With
   * no transport there is no status to read, which is the same state as a relay
   * nothing has connected to yet — so every row is `initialized`, which is what
   * the `??` below already said for a relay the client had no entry for.
   */
  rxNostr: RxNostr | undefined,
  notices: Readonly<Record<string, RelayMessage>>,
  refusals: Readonly<Record<string, RelayRefusalDiagnostic>>
): RelayDiagnostics {
  const status = rxNostr?.getAllRelayStatus() ?? {};
  // The scope's relays, in the scope's order, with the scope's capabilities.
  // Nothing iterates the client's list: a relay the client has and the scope
  // does not is not a relay any request of this provider can be asked of, so
  // putting it in the map would publish a row a consumer cannot act on and
  // cannot have caused.
  const entries = scope.relays.map((relay): [string, RelayDiagnostic] => [
    relay.url,
    {
      url: relay.url,
      // Still unreachable, and the reason changed rather than went away. It was
      // "every relay in the list has a status" (D6, RD6); the list this iterates
      // is the scope's now, so what would produce the gap is a scope relay the
      // client has no status for — which needs the drift above, and does not
      // arise from it either: a relay dropped from the client's list keeps its
      // status entry (measured, SEN19). It stays because the type permits the
      // gap, because SEN19 is what would notice if that changed, and because
      // the map is complete or it is nothing (#92): a relay is listed if the
      // consumer asked for it, whatever the socket layer knows about it.
      connection: publishedConnection(status[relay.url]?.connection ?? 'initialized'),
      // **A copy, frozen, and not the scope's own array.** `readonly` stops a
      // TypeScript assignment and cuts no alias at run time: a consumer — or a
      // consumer whose types were erased, which is every JavaScript one —
      // calling `configuredUrls.push(…)` reached the accepted scope's internal
      // metadata and changed it. Measured through the published row. This is
      // the same ownership boundary the published events have, at the other
      // published value.
      //
      // Empty is not reachable from a scope: every relay in it was named from
      // something the caller wrote. `?? []` is what the type needs rather than
      // a case.
      configuredUrls: Object.freeze([...(scope.configuredUrls[relay.url] ?? [])]),
      read: relay.read,
      write: relay.write,
      lastNotice: notices[relay.url],
      lastRefusal: refusals[relay.url]
    }
  ]);
  // **A dictionary with no prototype, because the type says a lookup finds a
  // row or nothing.** `Object.fromEntries` carries `Object.prototype`, so
  // `relays['toString']` was a function — neither of the two values the type
  // promises — and `relays['constructor']` and `relays['__proto__']` were worse.
  // `RD21` looked at one relay nobody configured and passed. The rows are frozen
  // for the reason the alias above is copied: what a consumer holds is not what
  // the provider holds.
  const map: Record<string, RelayDiagnostic> = Object.create(null) as Record<
    string,
    RelayDiagnostic
  >;
  for (const [url, diagnostic] of entries) map[url] = Object.freeze(diagnostic);
  return Object.freeze(map);
}

/**
 * The relay half of the diagnostics axis, as a runes value.
 *
 * Not an Observable. `useConnections()` returns one, which reads as a store to
 * anything that squints and is not one — it has no synchronous current value,
 * so `$store` in a template subscribes and waits, and Svelte's store contract
 * says the opposite (#91). A rune has the value now, which is the same property
 * the snapshot above provides, arrived at from the language's side.
 *
 * **A pure context reader: it subscribes to nothing, and that is a repair
 * rather than a tidying.** This used to build the notices record and the
 * `NOTICE` subscription *per call*, which scoped the answer to the hook instead
 * of to the provider. Measured, one provider, one relay, one socket: a panel
 * that called this **before** the relay sent `NOTICE "rate-limited: slow down"`
 * read it, and a panel that called it **after** read `undefined` — at the same
 * instant, on the same relay, in the same connection state. A diagnostics panel
 * is opened *because* a relay misbehaved, so it is mounted after the notice:
 * the one case the field exists for was the one case it structurally could not
 * answer.
 *
 * So the record is the provider's ({@link createRelayDiagnostics}), and both
 * fields here are read straight off the context — the map from the controller
 * the provider owns, the refusal from beside it, which is where C16 puts it and
 * which is the same cell the controller holds. Nothing is subscribed to here
 * and nothing is stored here, so every hook under one provider is a view of one
 * value. **Object identity is not part of that**: same provider, same instant,
 * same content is the whole claim, and each call returns its own two getters.
 */
export function useRelayDiagnostics(): {
  readonly relays: RelayDiagnostics;
  /**
   * The relay list this provider refused, if one is outstanding (C16).
   *
   * **Beside the map rather than in it**, because the map is keyed by relay and
   * a refused list is exactly the case where there is no relay to key it under:
   * a `read` flag that is not a boolean has no URL at all, and a set the
   * transport merges has names that belong to no generation. Putting it in the
   * map would need a row invented for it, which is the thing `RelayDiagnostics`
   * is a complete map in order not to have (#92).
   *
   * This is the only place a refused relay list is reported. It cannot be a
   * throw: the actor is `NostrApp.relays`, a prop applied in an `$effect`, and
   * an effect that throws under an error boundary takes the provider's subtree
   * with it (`CF6`) — so the contract "the previous generation survives" is not
   * one that path can keep.
   *
   * Read off the provider like the map beside it, and for the same reason: the
   * provider is what refused, so a hook that arrives afterwards is told, and two
   * hooks are never told different things.
   */
  readonly configurationError: RelayConfigurationError | undefined;
} {
  // C6: the connection is the provider's, so everything built from it is the
  // provider's too. The published form used to take a `() => RxNostr`, which is
  // a published function asking a consumer for the one object the ownership
  // decision says they never hold; it then went on to *build* the diagnostics
  // per call, which is the same mistake one level down — a fact the provider
  // owns, assembled by whoever asked to look at it.
  //
  // Read once, here, and captured. This is component initialisation, the window
  // `getContext` is legal in, and the getters below never read the context
  // again — the rule `LC8` holds for this hook and `LC9` holds for its members.
  const context = getNostrContext();
  return {
    get relays() {
      return context.diagnostics.relays;
    },
    get configurationError() {
      return context.configurationError;
    }
  };
}

/**
 * What the provider owns, and what every hook under it reads.
 *
 * The methods are the provider's half and are on this type rather than on the
 * published one for that reason: `setRelays` is the only caller of either, and
 * a consumer who could clear a refusal could clear one they have not shown.
 */
export interface RelayDiagnosticsController {
  readonly relays: RelayDiagnostics;
  readonly configurationError: RelayConfigurationError | undefined;
  /** Record a refused relay list (C16). Called from `setRelays`, nowhere else. */
  refuse(error: RelayConfigurationError): void;
  /** Clear it — only on the path a list was **accepted**. */
  accept(): void;
}

/**
 * The relay diagnostics, built once by the provider with the client injected.
 *
 * **One per provider, and that is the decision.** It used to be one per hook,
 * and everything below follows from moving it: the `NOTICE` subscription starts
 * when the provider is constructed, so notices are recorded with **zero hooks
 * mounted**, and a hook mounted later reads what arrived before it. What the
 * old shape could not answer is written out on {@link useRelayDiagnostics}.
 *
 * `lastNotice` therefore means: **the last `NOTICE` a relay sent this provider
 * during that relay's current continuous membership of the accepted scope.**
 * Its lifetime in full, because each clause is a thing a reader would otherwise
 * have to guess:
 *
 * - the subscription starts at construction, and notices are recorded with no
 *   hook mounted at all;
 * - every hook under one provider reads the same value, whenever it mounted;
 * - a notice survives reconnection and `read`/`write` changes, because neither
 *   moves the relay out of the scope;
 * - it is **discarded when the relay leaves the accepted scope**, so a re-added
 *   relay starts at `undefined`;
 * - a **refused** relay update keeps the previous scope and its notices, since
 *   nothing left the scope;
 * - provider teardown ends the subscription **and** discards every record, so a
 *   result held across it answers no relay rather than the last thing it saw —
 *   two obligations, and for several rounds this line described only the first;
 * - nothing is shared between providers — the record is a local of this call.
 *
 * **Pruning on removal is the point rather than a detail.** Keeping a URL for
 * the provider's whole life makes the record grow through a session that keeps
 * editing its relay list, and resurrects a stale notice the moment a URL comes
 * back — a message about a connection that no longer exists, shown beside one
 * that does.
 *
 * **Object identity is not part of any of this**: same provider, same instant,
 * same content is the claim, and `snapshot()` mints a new map per recompute.
 *
 * Still injectable, and now for one reason rather than two: a measurement can
 * drive it without a provider. "Where the client comes from" is no longer a
 * difference between what is published and what is tested, because the
 * published hook builds nothing.
 */
export function createRelayDiagnostics(
  /**
   * `undefined` where the provider has no live transport, which is a server.
   *
   * Typed to admit it rather than asserted away, because the alternative is a
   * provider that *needs* a connection — and then a server-rendered page could
   * either not construct this at all or would be handed a client made for it,
   * which is the resource this decision exists to not create.
   *
   * A value rather than a getter, which the transport half used to be: the
   * provider creates its client once and disposes it with itself (C6), so a
   * getter here would be a question with one answer for this object's whole
   * life. The scope beside it is the opposite case and stays a getter.
   */
  rxNostr: RxNostr | undefined,
  getScope: () => RelayScope,
  /**
   * The provider's clock, **sampled**, for `lastRefusal`'s timestamp.
   *
   * Taken rather than reached for, because `A-δ` makes the clock the provider's
   * and a diagnostics axis reading `Date.now()` would be a second notion of time
   * on one provider — and one a test could not hold still. `sample()` rather
   * than the reactive `now`, because recording when a message arrived must not
   * subscribe this handler to the expiry clock's ticks: the value wanted is the
   * instant, not a dependency on it. It is already whole unix seconds, so
   * nothing here converts a unit.
   */
  sampleNow: () => UnixSeconds
): RelayDiagnosticsController {
  // A plain record rather than a Map, and deliberately not reactive: the
  // snapshot below is recomputed explicitly, so making this a tracked
  // collection would recompute twice and hide which write caused which read.
  const notices: Record<string, RelayMessage> = {};
  const refusals: Record<string, RelayRefusalDiagnostic> = {};
  let relays = $state<RelayDiagnostics>(snapshot(getScope(), rxNostr, notices, refusals));
  /**
   * Refused after construction, and nothing has been accepted since (C16).
   *
   * Here rather than on the provider because this is where the diagnostics
   * live: the refusal and the map are the two things a diagnostics panel reads,
   * and one owner for both is what stops them being answered by two different
   * lifetimes again. The provider republishes it as `context.configurationError`
   * — a getter over this cell, not a copy of it.
   *
   * `$state` because its readers are runes values a template reads; a plain
   * field would leave a consumer with a refusal that arrives and never
   * re-renders.
   */
  let configurationError = $state<RelayConfigurationError | undefined>(undefined);

  /**
   * Everything said by a relay the scope no longer has, dropped.
   *
   * The membership test is the same one the `NOTICE` handler applies on the way
   * in, from the other end: a notice from outside the scope is never recorded,
   * and one recorded for a relay that then leaves does not survive it. Together
   * they are what bounds the record by the scope rather than by the session.
   */
  const prune = (scope: RelayScope): void => {
    for (const url of Object.keys(notices)) {
      if (!scope.relays.some((relay) => relay.url === url)) delete notices[url];
    }
    // The same rule for the same reason: a refusal recorded for a relay that
    // then leaves the accepted scope has nowhere to be shown, and keeping it
    // would let the record grow by the session rather than by the scope.
    for (const url of Object.keys(refusals)) {
      if (!scope.relays.some((relay) => relay.url === url)) delete refusals[url];
    }
  };

  $effect(() => {
    const scope = getScope();
    prune(scope);
    relays = snapshot(scope, rxNostr, notices, refusals);

    // Nothing to observe without a transport, and the map above is already
    // complete without it. **This line is not what makes SSR work** — Svelte's
    // server compiler emits no `$effect` at all, so on a server the body never
    // runs and the value the return below publishes is the one computed at
    // construction. It is here because the type admits the case and a `!` here
    // would be an assertion about a caller rather than about this function.
    if (rxNostr === undefined) return;

    const subscriptions = [
      rxNostr.createConnectionStateObservable().subscribe(() => {
        relays = snapshot(scope, rxNostr, notices, refusals);
      }),
      rxNostr.createAllMessageObservable().subscribe((packet) => {
        if (packet.type !== 'NOTICE') return;
        // Kept for whatever the scope says now rather than for whoever sent it:
        // a `NOTICE` from a relay outside the scope has nowhere to be shown, and
        // dropping it here rather than at the read is what stops the record
        // growing without bound while the map it feeds cannot.
        if (!scope.relays.some((relay) => relay.url === packet.from)) return;
        // Read as text whatever arrived: `lastNotice` is published as a
        // string and a relay can put anything in a `NOTICE` body.
        notices[packet.from] = relayMessage(packet.notice);
        relays = snapshot(scope, rxNostr, notices, refusals);
      }),
      // **`CLOSED` on the relay axis, which is the half the `NOTICE` repair
      // left.** A relay refusing a subscription is the commonest reason it is
      // useless to a consumer — `auth-required:` above all — and it was readable
      // only through a request, so a panel opened *because* a relay is
      // misbehaving could not say which relay was refusing. Same membership
      // test, same bound, same pruning as a notice; the classification is the
      // one a request's `Refusal` uses, so the two axes cannot disagree about
      // what a message means.
      rxNostr.createAllMessageObservable().subscribe((packet) => {
        if (packet.type !== 'CLOSED') return;
        if (!scope.relays.some((relay) => relay.url === packet.from)) return;
        const notice = relayMessage(packet.notice);
        refusals[packet.from] = Object.freeze({
          reason: classifyRefusal(notice.text),
          notice,
          // Already whole unix seconds; see `sampleNow`.
          observedAtUnixSeconds: sampleNow()
        });
        relays = snapshot(scope, rxNostr, notices, refusals);
      })
    ];

    return () => {
      for (const subscription of subscriptions) subscription.unsubscribe();
    };
  });

  /**
   * Teardown discards the record, which is the half `RD16` used to contradict.
   *
   * 0004 says provider teardown "ends the subscription and discards
   * everything", and only the first half was true: the subscription stopped,
   * the map froze at its last snapshot, and the getters went on serving it. A
   * consumer can watch that go wrong, because 0004 also licenses holding the
   * diagnostics result and reading it from anywhere afterwards — so a panel
   * kept across a teardown showed `connected` and a relay's complaint for a
   * socket that had been disposed. Silence read as health.
   *
   * **A second effect rather than a line in the one above**, because those two
   * cleanups do not mean the same thing. The subscription effect re-runs on
   * every accepted generation, and its cleanup is what closes the *previous*
   * generation's subscriptions — discarding there would empty the record on a
   * relay-list change, which is `C-δ-C5`'s "the notice survives" clause. This
   * body reads no state, so it never re-runs, and its cleanup runs exactly once:
   * when the root that owns it is destroyed. That is the distinction Svelte does
   * not otherwise give — one teardown callback for "again" and for "never
   * again" — and the empty body is load-bearing rather than a stub.
   */
  $effect(() => () => {
    for (const url of Object.keys(notices)) delete notices[url];
    for (const url of Object.keys(refusals)) delete refusals[url];
    // `NO_RELAYS` rather than `{}`, and the difference is the whole of `RD23`
    // on this path: an object literal carries `Object.prototype`, so after a
    // teardown `relays['toString']` was a function — neither of the two values
    // `RelayDiagnostics` admits — and the map a consumer went on holding was
    // writable. The live snapshots were built with `Object.create(null)` and
    // frozen from the round that defect was closed; the teardown one line away
    // was still a literal. Measured through the published hook across a real
    // unmount.
    relays = NO_RELAYS;
    configurationError = undefined;
  });

  return {
    get relays() {
      return relays;
    },
    get configurationError() {
      return configurationError;
    },
    // Two verbs rather than one setter taking `undefined`, because the two
    // paths are not symmetric: C16 says the *next accepted list* is the only
    // thing that clears a refusal while the provider is alive, and a single
    // `set` would let "nothing was refused this time" be written by any caller
    // that had nothing to say. The teardown below clears it too, and does so
    // without going through either verb — which is the point: it is not a
    // caller with nothing to say, it is the end of the thing that was saying.
    refuse(error: RelayConfigurationError) {
      configurationError = error;
    },
    accept() {
      configurationError = undefined;
    }
  };
}
