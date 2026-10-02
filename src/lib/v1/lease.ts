/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The transport, as a capability the provider can take back.
 *
 * **A request that holds the client cannot be told the owner is gone.** It used
 * to be handed `rxNostr` itself, and the only way to find out that the provider
 * had disposed it was to *use* it and catch what the dependency threw — a
 * check-then-use with a window in between, arriving as rx-nostr's own error
 * rather than as anything this library could classify.
 *
 * **The first repair was a lease that handed the client back, and that is not a
 * capability.** `claim()` returned the raw `RxNostr`, so a request that had
 * already claimed one kept working after the revoke:
 *
 * ```ts
 * const held = lease.claim();
 * lease.revoke();
 * // `held` is still a live client
 * ```
 *
 * Revocation that only changes the *next* answer proves nothing about the
 * request already running, and a reviewer measured that the production path
 * never claimed at all — `requestTargets`, the machine and the stream all read
 * a raw client destructured from the caller's options, so the lease governed one
 * `refresh()` pre-check and nothing else.
 *
 * So this hands out **operations, not the object**. Every call is checked
 * against the revocation at the moment it is made, and there is no expression
 * anywhere that yields an `RxNostr` a caller can keep.
 *
 * **And the second repair was one level down, where the same defect was
 * waiting.** Four of these operations answer an observable, and returning the
 * dependency's own is object lending with an extra step: `rxNostr.use()` is
 * lazy, so what it hands back closes over the client and starts the work when it
 * is *subscribed*. A reviewer took one before the revoke, subscribed it inside
 * the abort listener — after the revoke, before the provider's `dispose()` — and
 * the relay received a `REQ`. The guard was at the call and the work was at the
 * subscribe. What those four answer now is an observable this module owns: it
 * builds the dependency's at **subscribe** time, behind the same `held()`, and
 * registers what it opens so the revoke can stop it. A value retained across a
 * revoke therefore has no more path to a client than the capability does.
 *
 * Disposal is one linearised operation:
 *
 * 1. `revoke()` — every operation refuses from this instant, **every value an
 *    operation handed out earlier refuses too**, and the subscriptions this
 *    capability opened are stopped,
 * 2. running attempts are cancelled,
 * 3. any `refresh()` still in flight is rejected with `provider-disposed`,
 * 4. and only then is the client disposed.
 *
 * Nothing can observe step 4 through a capability, because step 1 already
 * refuses and step 1 has no leftovers. That is what lets `provider-disposed` be
 * a **rejection-only** code: a request cannot fail with it, because after the
 * revoke there is no request still reaching the wire.
 *
 * **The spike's low-level seam takes a client rather than a capability** — `A16` decides v1 has no such seam, so this is a fact about this branch — and
 * {@link callerTransport} is what that becomes: a capability nobody can revoke,
 * because nobody here owns the client — `revoked: false` in its **type**, so
 * `provider-disposed` is out of reach on that path by something a compiler
 * checks. A caller who hands this library a client and then disposes it is not a
 * provider disposing its own; that is an unusable seam, and it is refused by the
 * name of the seam like any other. The two are separate branches on purpose —
 * one event, one classification.
 */
import type { RxNostr } from 'rx-nostr';
import type { Subscription } from 'rxjs';
import { filter, map, Observable } from 'rxjs';

import type { RelayMessage } from './normalize.js';
import { relayMessage } from './normalize.js';

/**
 * What an outgoing `REQ` tells this library — and the whole of what crosses the
 * seam with it.
 *
 * **This used to be the dependency's own frame, copied.** rx-nostr publishes the
 * packet *before* it serialises it, and the filter objects in it are the ones
 * the client keeps on its subscription record, so a subscriber that wrote to one
 * changed what went on the wire and what the client admitted afterwards. The
 * first repair copied the frame — the packet, and each part of its `message`
 * array. **A reviewer measured that copy and it was one level short**: `{ ...part }`
 * shares the filter's own arrays, so `packet.message[2].kinds.push(2)` reached
 * the caller's array *and* the relay, which received `kinds: [1, 2]`. That is
 * the same counterexample the copy was written to close, one container down.
 *
 * So the seam carries no graph at all. The only reader in this library is the
 * machine, which advances a leg when a relay is asked — it reads who was asked
 * and under which subscription id, and nothing else — and two frozen strings
 * cannot alias anything the client keeps. A port that needs more owes the depth
 * for whatever it adds, in the sense `0003` gives that debt for the normalised
 * descriptor.
 */
export interface RelayControlMessage {
  /** `EOSE` or `CLOSED` — the two this library reads. */
  readonly type: 'EOSE' | 'CLOSED';
  /** The relay it came from. */
  readonly from: string;
  /** The subscription id it names. */
  readonly subId: string;
  /**
   * What a `CLOSED` said, rendered by this library, and `undefined` for an
   * `EOSE`.
   *
   * **Rendered here rather than carried raw, and `OW13` is why.** The protocol
   * says a `CLOSED` reason is a string and a relay is free to write anything;
   * one that writes an object used to reach the machine and be described there.
   * A projection that dropped a non-string notice made that object *absent*
   * instead — the arm caught it — and a projection that passed it through would
   * hand the relay's own value across the seam, which is what this projection
   * exists to stop. So the seam renders it: bounded, frozen, and this library's.
   */
  readonly notice: RelayMessage | undefined;
}

export interface OutgoingRequest {
  /** The relay the `REQ` went to. */
  readonly to: string;
  /** The subscription id it went out under. */
  readonly subId: string;
}

/**
 * What a request may do with the provider's transport.
 *
 * **An operation answers `undefined` when the capability has been revoked, and
 * when the underlying client throws.** Those are the two, and the second is not
 * every unusable client: rx-nostr 3.7.5 guards some of its accessors and not
 * others — `getDefaultRelays()` raises `RxNostrAlreadyDisposedError` on a
 * disposed client and `getAllRelayStatus()` answers `{}` — so
 * {@link TransportCapability.relayStatus} reports a value for a client
 * {@link TransportCapability.defaultRelays} refuses. A guard written on the
 * first was a branch with no entrance, measured. The read that answers "this
 * client is unusable" is `defaultRelays`, and `requestTargets` is where that
 * refusal is published, once.
 *
 * {@link TransportCapability.revoked} is a different question, and only the
 * provider's own capability can answer it `true`.
 */
export interface TransportCapability {
  /** Whether the owner has taken it back. */
  readonly revoked: boolean;
  /** `getAllRelayStatus`, or `undefined`. */
  relayStatus(): ReturnType<RxNostr['getAllRelayStatus']> | undefined;
  /** `getDefaultRelays`, or `undefined`. */
  defaultRelays(): ReturnType<RxNostr['getDefaultRelays']> | undefined;
  /** `reconnect`, and a no-op once revoked. */
  reconnect(url: string): void;
  /** `use`, or `undefined`. */
  use(...args: Parameters<RxNostr['use']>): ReturnType<RxNostr['use']> | undefined;
  /**
   * `send`, or `undefined`. **Through the lease for the reason `use` is**: the
   * owner taking the capability back completes the answer's observable, so a
   * send in flight when its provider goes away ends instead of waiting out the
   * dependency's OK timer, and {@link TransportCapability.revoked} then says why
   * it ended — which is how `useSend` tells `aborted` from `no-response`.
   */
  send(...args: Parameters<RxNostr['send']>): ReturnType<RxNostr['send']> | undefined;
  /**
   * Call `listener` once when the owner takes the capability back, and answer
   * the removal. **For a wait that is not a subscription** — a send signing or
   * verifying before anything went out has no observable for the revoke to
   * complete, so this is how it hears the provider go. **On a capability already
   * revoked the listener is called at once** and nothing is registered.
   * Answering nothing instead assumed the caller had just read
   * {@link TransportCapability.revoked}, and a send reads the caller's options
   * between that read and this registration — a getter that destroys the
   * provider there left the wait with nobody to end it.
   */
  onRevoke(listener: () => void): () => void;
  /** Every `REQ` this client sends, as {@link OutgoingRequest}, or `undefined`. */
  outgoingRequests(): Observable<OutgoingRequest> | undefined;
  /** `createConnectionStateObservable`, or `undefined`. */
  connectionState(): ReturnType<RxNostr['createConnectionStateObservable']> | undefined;
  /** The `EOSE` and `CLOSED` this client receives, as {@link RelayControlMessage}. */
  controlMessages(): Observable<RelayControlMessage> | undefined;
}

/** The owner's end: the capability, plus the one operation only the owner has. */
export interface OwnedTransport {
  readonly capability: TransportCapability;
  /**
   * Take it back.
   *
   * Idempotent, because a provider that is destroyed twice — Svelte runs an
   * effect's teardown once, but a port's lifecycle may not — must not turn the
   * second call into a different answer.
   */
  revoke(): void;
}

/**
 * Every read of the client is guarded: a disposed one throws from some of them.
 *
 * **And the answers are the dependency's own types, not re-declared ones.** Two
 * of these were written out by hand — `Record<string, { connection: string }>`
 * and its neighbour — which needed a cast at the call, and a cast is where a
 * type stops being checked. `ReturnType<RxNostr['…']>` is what the other five
 * members already use, it needs no cast, and it keeps rx-nostr's `ConnectionState`
 * union instead of widening it to `string` for every reader downstream.
 */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * **Generic in the answer to "can this be revoked", so the type carries it.**
 * A capability over a client the caller owns is never revoked, and that was an
 * implementation fact — `() => false` in one function — while the type said
 * `boolean` like any other. `provider-disposed` being out of reach on that path
 * is one of this design's load-bearing claims, so it is `revoked: false` in the
 * type there and `boolean` where a provider really can take its client back.
 * Written as a parameter rather than a cast: the literal reaches the property
 * through inference, and a `revoked` that stopped being `false` would stop
 * compiling at the call site instead of at nothing.
 */
/**
 * A record the holder cannot write the client through.
 *
 * **`getDefaultRelays()` hands back the client's own configuration objects.**
 * The outer record is fresh on each call, and the entries in it are not:
 * measured against rx-nostr 3.7.5, `Object.values(answered)[0].read = false`
 * changes what the *client* answers from then on. So a request that holds what
 * this operation returned can reconfigure the provider's transport — after a
 * revoke as easily as before it, because the record does not go stale.
 *
 * That is the same defect as returning the client, two levels along: not a
 * lazy start this time but a live handle on its state. The capability copies,
 * and freezes the copy so that a holder who tries is told rather than quietly
 * writing to nothing.
 *
 * `getAllRelayStatus()` builds fresh entries today; it is projected on the same
 * line anyway, because "which of the dependency's accessors happens to allocate"
 * is exactly the sort of fact this module has been wrong about twice.
 *
 * **A copy of whatever arrived was the first form, and a reviewer named what it
 * leaves.** `{ ...value }` is complete only while every field the dependency's
 * entry carries is a primitive — true of rx-nostr 3.7.5, where the two shapes
 * are `{ url, read, write }` and `{ connection }`, and quietly false the day
 * either gains one that is not. That is the debt `0003` records for the
 * normalised descriptor, and `C11-C17`'s port column carries it now. What is
 * built here instead is a **projection this library names**: the members below
 * are the whole of what crosses, a field added upstream cannot join the
 * published graph by arriving, and if one is added to a shape we publish, this
 * stops compiling rather than starting to leak. `RM22` is the run-time half,
 * over a client that answers more than these.
 */
/**
 * **Naming a member is not the same as publishing a primitive**, and a reviewer
 * measured the difference. A projection that copies `status.connection` copies
 * whatever is there: a client answering an object on a member the projection
 * *names* hands that object straight out, which is the very thing the projection
 * replaced a copy to prevent. The declared shapes are primitives all the way
 * down — `{ url: string, read: boolean, write: boolean }` and
 * `{ connection: ConnectionState }` — so a member that is not the primitive it
 * is declared to be means this client is not answering the shape the dependency
 * documents, and the read refuses **as a whole**, the same way it refuses a
 * client that throws.
 *
 * Refusing the whole answer rather than dropping the entry is deliberate: a
 * shorter list is a different question answered silently, and `requestTargets`
 * would publish it as "these are your relays".
 */
const primitive = (value: unknown, kind: 'string' | 'boolean'): boolean => typeof value === kind;

const relayStatusOf = (
  answered: ReturnType<RxNostr['getAllRelayStatus']> | undefined
): ReturnType<RxNostr['getAllRelayStatus']> | undefined => {
  if (answered === undefined) return undefined;
  const projected: Record<string, { connection: string }> = {};
  for (const [url, status] of Object.entries(answered)) {
    if (!primitive(status?.connection, 'string')) return undefined;
    projected[url] = Object.freeze({ connection: status.connection });
  }
  return Object.freeze(projected) as ReturnType<RxNostr['getAllRelayStatus']>;
};

const defaultRelaysOf = (
  answered: ReturnType<RxNostr['getDefaultRelays']> | undefined
): ReturnType<RxNostr['getDefaultRelays']> | undefined => {
  if (answered === undefined) return undefined;
  const projected: Record<string, { url: string; read: boolean; write: boolean }> = {};
  for (const [url, config] of Object.entries(answered)) {
    if (
      !primitive(config?.url, 'string') ||
      !primitive(config?.read, 'boolean') ||
      !primitive(config?.write, 'boolean')
    ) {
      return undefined;
    }
    projected[url] = Object.freeze({ url: config.url, read: config.read, write: config.write });
  }
  return Object.freeze(projected);
};

function capabilityOver<R extends boolean>(
  held: () => RxNostr | undefined,
  revoked: () => R,
  live: Set<() => void>
): TransportCapability & { readonly revoked: R } {
  /**
   * An observable the **capability** owns, over one the dependency does.
   *
   * **Returning the dependency's own is object lending one level down, and a
   * reviewer measured it.** `rxNostr.use()` is lazy: the REQ goes out when the
   * returned observable is subscribed, not when `use()` returns, and the value
   * it returns closes over the client, its connection table and its subjects.
   * So a caller could take one before the revoke, subscribe it after — inside
   * the abort listener, before the provider's `dispose()` — and the relay
   * received a `REQ`. "No wire operation begins after the revoke" was false, and
   * the capability's guard could not see it because the guard ran at the *call*.
   *
   * Two things fix it, and both are needed. The dependency's observable is
   * built **at subscribe time**, behind the same `held()` the operations use —
   * so a value retained across a revoke has no path to a client, exactly as the
   * capability itself has none. And every subscription this hands out is
   * registered, so `revoke()` stops the ones already running rather than leaving
   * them to a consumer that remembers to listen. A `takeUntil` on the abort
   * would do neither: it does not stop a subscriber that arrives after the
   * signal has already fired.
   */
  /**
   * What a delivery may carry out of the client, per operation.
   *
   * **The copy rule was derived over the two synchronous reads, and the
   * population is six.** `snapshot` was written when `defaultRelays()` was found
   * to answer the client's own configuration entries — and its own comment says
   * "which of the dependency's accessors happens to allocate is exactly the sort
   * of fact this module has been wrong about twice". It was then applied to the
   * two reads and to nothing else, which is the same mistake a third time: a
   * reviewer measured that `createOutgoingMessageObservable()` delivers the
   * frame **before it is serialised**, and that the filter objects inside it are
   * the ones the client keeps on its subscription record and matches incoming
   * events against. A subscriber rewriting `packet.message[1]` changed the subId
   * on the wire; rewriting `packet.message[2].kinds` changed what the client
   * admitted afterwards, permanently.
   *
   * **Copying the frame was the repair, and a second reviewer measured it one
   * container short.** Each part of `message` was spread, which leaves the
   * filter's own arrays shared: driven through this capability,
   * `packet.message[2].kinds.push(2)` turned the caller's `[1]` into `[1, 2]`
   * **and the relay received `kinds: [1, 2]`** — the very counterexample the
   * copy cites, still open, while the `message[1]` half of the same sentence was
   * closed. A deeper copy would answer this instance and leave the next
   * container to the next reviewer, so the seam carries a **projection** instead:
   * {@link OutgoingRequest}, two frozen strings, built at the boundary. There is
   * no graph to reach, at any depth, and `machine.ts` — the only reader — asked
   * for nothing else.
   *
   * A generic copier was written before either, keyed on "does this have a
   * `message` array", and `AE24` refused it: that arm counts the reads taken of a
   * candidate event and holds `A-ε`'s order — the gate refuses before anything is
   * read off what it refused — so a copier that so much as *asks* a delivered
   * packet for a field is a read the order forbids. Projecting at this seam is
   * not that: it reads an **outgoing** packet, which no gate refuses.
   *
   * The two that carry the *relay's* data rather than the client's — `use()` and
   * `allMessages()` — are untouched, and that is a decision with two reasons
   * rather than an omission: what they deliver is inbound, the library owns it at
   * the event boundary before anything keeps it (`ownPacket`), and reading it
   * here would break the order `AE24` measures. What it leaves is a channel
   * between two subscribers inside this library — implementation topology, which
   * a reviewer ruled is not the ADR's to carry: neither subscriber writes, the
   * capability is not published, and `allMessages()`'s reader takes `EOSE` and
   * `CLOSED` only.
   */
  /**
   * **The inbound half, narrowed for the same reason as the outbound one.**
   * `createAllMessageObservable()` is a plain Subject: every subscriber is
   * handed the *same* packet object, and `message[2]` on an `EVENT` is the event
   * the client parsed — measured against a real relay, a write on this channel
   * changed what `use()` delivered to the other subscriber. The two reasons this
   * module gave for leaving it alone were that the library owns inbound values
   * at the event boundary and that reading here would break the order `AE24`
   * measures. The first is true of `use()`; the second is false of this seam, and
   * an outside reviewer said so: `machine.ts` — the only reader — already takes
   * `type`, `subId`, `from` and `notice` off **every** delivery before any gate
   * runs, so a projection of exactly those adds no read the order forbids.
   *
   * `EVENT` never crosses, which is the whole of what the machine ignored anyway.
   */
  const controlMessages = (client: RxNostr): Observable<RelayControlMessage> =>
    client.createAllMessageObservable().pipe(
      map((packet) => {
        const held = packet as {
          type?: unknown;
          from?: unknown;
          subId?: unknown;
          notice?: unknown;
        };
        if (held.type !== 'EOSE' && held.type !== 'CLOSED') return undefined;
        if (typeof held.from !== 'string' || typeof held.subId !== 'string') return undefined;
        return Object.freeze({
          type: held.type,
          from: held.from,
          subId: held.subId,
          notice: held.type === 'CLOSED' ? relayMessage(held.notice) : undefined
        });
      }),
      filter((message): message is RelayControlMessage => message !== undefined)
    );

  const outgoingRequests = (client: RxNostr): Observable<OutgoingRequest> =>
    client.createOutgoingMessageObservable().pipe(
      map((packet) => {
        const message = packet.message as readonly unknown[];
        const subId = message[1];
        return message[0] === 'REQ' && typeof subId === 'string'
          ? Object.freeze({ to: packet.to, subId })
          : undefined;
      }),
      filter((request): request is OutgoingRequest => request !== undefined)
    );

  const owned = <T>(make: (client: RxNostr) => Observable<T>): Observable<T> | undefined => {
    if (held() === undefined) return undefined;
    return new Observable<T>((subscriber) => {
      const client = held();
      if (client === undefined) {
        subscriber.complete();
        return;
      }
      const source = attempt(() => make(client));
      if (source === undefined) {
        subscriber.complete();
        return;
      }
      // **Complete first, and the other order is a silent no-op.** Passing the
      // outer `subscriber` as the inner observer links the two, so unsubscribing
      // the inner one closes the outer as well — and `complete()` on a closed
      // subscriber delivers nothing. Measured: the holder's `complete` never
      // ran, so a revoke stopped the traffic and left the holder waiting.
      // Declared before the subscribe so `stop` can close over it, and read
      // through the box for the same reason: the teardown below and the sweep
      // above both reach the subscription by this name.
      const opened: { inner?: Subscription } = {};
      const stop = (): void => {
        subscriber.complete();
        opened.inner?.unsubscribe();
      };
      // **Registered before the subscribe rather than after it, and nothing
      // measures the difference.** The reason to prefer this order is that
      // `subscribe()` may deliver synchronously, and a consumer whose `next`
      // revokes — a handler that stops on the first packet is an ordinary thing
      // to write — would run the revoke's sweep before a later registration
      // existed. Through this dependency that does not happen: rx-nostr's
      // observables are Subject-backed and deliver on a later turn, so `RM19`
      // drives exactly that consumer and stays green with the two lines
      // swapped. It is written this way because it costs nothing and the other
      // order is wrong for a source that does deliver synchronously — **not**
      // because an arm here holds it, and a guard was deleted from below this
      // line for having no entrance at all.
      live.add(stop);
      opened.inner = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (reason: unknown) => subscriber.error(reason),
        complete: () => subscriber.complete()
      });
      return () => {
        live.delete(stop);
        opened.inner?.unsubscribe();
      };
    });
  };

  return {
    get revoked(): R {
      return revoked();
    },
    // **The projection is inside the guard, and it was outside for two rounds.**
    // `attempt` is what makes the docblock's sentence true — an operation
    // answers `undefined` when the client throws — and it wrapped only the
    // accessor call. The projection then enumerated the answer and read its
    // fields *outside* it, so a client whose entry answers through a getter
    // that throws (or an accessor that answers `null`) made the operation
    // **throw** instead of refusing: measured through the hook, a `refresh()`
    // rejected with the caller's own `Error`, which is the one thing
    // `RefreshRejection` promises never happens. That is the same shape as the
    // repairs above — the guard stayed where it was and the new code went
    // outside it — and it arrived with `snapshot`, one round before the
    // projection replaced it. `RM23`.
    relayStatus: () => attempt(() => relayStatusOf(held()?.getAllRelayStatus())),
    defaultRelays: () => attempt(() => defaultRelaysOf(held()?.getDefaultRelays())),
    reconnect: (url) => {
      attempt(() => held()?.reconnect(url));
    },
    use: (...args) => owned((client) => client.use(...args)),
    send: (...args) => owned((client) => client.send(...args)),
    onRevoke: (listener) => {
      if (held() === undefined) {
        listener();
        return () => undefined;
      }
      live.add(listener);
      return () => {
        live.delete(listener);
      };
    },
    // **The one delivery that carried the client's own state out.** rx-nostr
    // publishes the frame *before* it serialises it, and the filter objects in
    // it are the ones the client keeps on its subscription record and matches
    // incoming events against — so a subscriber rewriting `message[1]` changed
    // the subId on the wire, and rewriting `message[2].kinds` changed what the
    // client admitted from then on, permanently. Both were measured; copying the
    // frame closed the first and left the second, because the copy stopped at
    // the filter object. What crosses now is a projection, not the frame.
    outgoingRequests: () => owned(outgoingRequests),
    connectionState: () => owned((client) => client.createConnectionStateObservable()),
    controlMessages: () => owned(controlMessages)
  };
}

/**
 * The owner's capability over a client it created.
 *
 * The client is captured in the closure and never returned from anything, so a
 * consumer holding the capability holds no path to it: revocation is not a flag
 * beside the value, it is the value being unreachable.
 */
export function ownTransport(transport: RxNostr): OwnedTransport {
  let held: RxNostr | undefined = transport;
  const live = new Set<() => void>();
  return {
    capability: capabilityOver(
      () => held,
      () => held === undefined,
      live
    ),
    revoke(): void {
      if (held === undefined) return;
      held = undefined;
      // **The subscriptions this capability opened are stopped here, rather than
      // left to whoever holds them.** An `AbortSignal` stood beside this for a
      // round and the machine listened to it — a *notification*, which a
      // consumer that listens acts on and one that does not ignores, leaving a
      // live subscription against a client one step from `dispose()`. Ending
      // what was lent makes the stopping a property of the capability instead,
      // and it made the listener unfalsifiable: removing it left every arm
      // green. The signal went with it. Iterated over a copy because stopping
      // one removes it from the set.
      for (const end of [...live]) end();
      live.clear();
    }
  };
}

/**
 * A capability over a client this library does not own, read where it lives.
 *
 * The spike's low-level seam takes an `rxNostr` **option**, and an option is a thunk the
 * caller re-evaluates: `P18` moves a live request from a dying client to a
 * healthy one by returning a different one, and a capability that closed over
 * the first read would keep asking the dead client for ever. So the read is
 * deferred to each operation, which is what the raw destructure it replaced did.
 *
 * **It is never revoked, and that is not a weaker version of `ownTransport` —
 * it is the honest answer.** This library cannot say "the owner is gone" about a
 * client whose owner is the caller, so {@link TransportCapability.revoked} is
 * `false` here **in the type as well as at run time**, and `provider-disposed`
 * is out of reach on this path by something a compiler checks rather than by a
 * line somebody could edit. `RM16` reads both edges of that. What it can still say is that the client refuses every
 * operation, which is an unusable **seam** and is refused by that name
 * (`invalid-descriptor` on `rxNostr`). One ownership event, one classification:
 * a caller who disposes their own client gets the same answer from the initial
 * request and from `refresh()`, which is the split `RM4`/`RM5` measure.
 */
export function callerTransport(
  read: () => RxNostr | undefined
): TransportCapability & { readonly revoked: false } {
  // Its own set, and nothing ever empties it: there is no revoke on this path,
  // so what it holds is the bookkeeping of subscriptions that end on their own.
  // The registration is kept rather than skipped so that both capabilities hand
  // out the *same* kind of observable — one built at subscribe time, behind the
  // read — and a difference in what a request is given cannot depend on which
  // constructor made it.
  return capabilityOver(read, () => false, new Set());
}
