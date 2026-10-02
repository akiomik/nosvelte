/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type Nostr from 'nostr-typedef';

import type { AttemptId, AttemptRegistry } from './attempt.js';
import type { OwnedPacket } from './event.js';
import type { BacklogEnd, Refusal } from './eventset.js';
import type { TransportCapability } from './lease.js';
import { referenceStream } from './machine.js';
import type { NormalizedDescriptor, ReadonlyFilter } from './normalize.js';
// **A-γ's initial value is imported, not declared a second time.** There were
// two live constants, both `5_000`: normalization resolves the caller's
// descriptor against one of them — so it is the one the cache key sees — and
// this module's parameter default was the other. They agreed, and nothing said
// they had to; a port that moves one ships a request whose descriptor names one
// deadline and whose run uses another. It is imported rather than re-exported
// because a module that republishes a name is a second entry (`SUR2`), which is
// a bigger claim than this needs. `WR22` counts the declarations and `A-γ-C2`
// is where the record says there is one.
import { cloneFilter, DEFAULT_SETTLE_TIMEOUT_MS, InvalidDescriptorError } from './normalize.js';
import { ownedByLibrary } from './owned.js';
import type { RelayLegError } from './reqerror.js';
import type { RelayScope } from './scope.svelte.js';
import { canonicalUrl } from './scope.svelte.js';

/**
 * What to do with a descriptor before any subscription is opened.
 *
 * Two cases never reach the wire, and they used to share one boolean and one
 * answer. They are not the same question:
 *
 * - `'empty'` — an empty set field matches nothing (`{ ids: [] }` is not `{}`),
 *   so the request can only ever return zero events. The answer is known, and
 *   `settled` with nothing in it is the honest report. This is #79. It is also a
 *   correctness guard rather than an optimisation: rx-nostr drops empty set
 *   fields on the way out, so the request that would go out is the *wider* one
 *   with the constraint removed (CONST-R17, CTR-4).
 * - `'defer'` — on the server there is no consumer to stream to and no teardown
 *   to hang the subscription off. Nothing has been asked, so nothing is known,
 *   and reporting `settled` would render "nothing found" during SSR and then
 *   replace it after hydration. That is #74's symptom in a new place. The
 *   honest report is `loading`, which is the same answer B-γ gives to "no
 *   readable relays" — one rule, "not asked means loading", covers both.
 *
 * Both are stated as things the engine does *not* do, which is why they are
 * tested by adding the behaviour back rather than by removing something.
 */
export type RequestPlan = 'open' | 'empty' | 'defer';

/**
 * The filters that may go on the wire.
 *
 * Unsatisfiable ones are removed rather than sent: an empty set field is
 * stripped upstream, which turns "matches nothing" into "matches everything of
 * that kind" — so passing one along inside an OR array widens the request.
 *
 * Copied on the way out, and that is the second half of the boundary rather
 * than caution. The array returned here was new and its *elements* were the
 * descriptor's own, so the snapshot `normalizeDescriptor` took was handed
 * straight back to whoever asked for the wire — one mutation away from the key
 * and the wire disagreeing, which is the divergence the boundary exists to
 * remove. The descriptor's filters are `ReadonlyFilter` now, so this is also
 * how they become the mutable shape the dependency's signature asks for; a cast
 * would have satisfied the compiler and kept the alias.
 */
export function wireFilters({ filters }: NormalizedDescriptor): Nostr.Filter[] {
  return filters.filter(isSatisfiable).map(cloneFilter);
}

/**
 * Can this filter match anything at all?
 *
 * One predicate, because two of them drifting apart is not a cosmetic problem:
 * `planRequest` decides whether to send, `wireFilters` decides what to send, and
 * if the first says yes while the second removes everything, the request that
 * goes out has no filters — and rx-nostr does not send those, so nothing comes
 * back and nothing says why.
 */
function isSatisfiable(filter: ReadonlyFilter): boolean {
  // An empty set field matches nothing; an absent one matches everything.
  return !Object.entries(filter).some(([, value]) => Array.isArray(value) && value.length === 0);
}

export function planRequest(
  { filters, environment }: NormalizedDescriptor,
  readable?: number
): RequestPlan {
  if (environment === 'server') return 'defer';
  // **Before the relay count, because an answer that needs no relay does not
  // need one.** This used to sit below the `readable === 0` line, so a request
  // whose every filter can match nothing — `{ kinds: [7], authors: [] }` — was
  // reported as "not asked yet" for as long as the relay list was empty, and
  // never settled. `key.ts` says an empty set field is a *known* membership
  // that "`planRequest` answers without asking anybody"; in that cell it did
  // not. The two guards are ordered by what they know: this one knows the
  // answer, the one below knows only that it cannot ask.
  if (filters.length === 0) return 'empty';
  if (!filters.some(isSatisfiable)) return 'empty';
  // B-γ. With nowhere to ask, the request has not been asked — so it reports
  // what "not asked" reports, which is the same answer the server gets and for
  // the same reason. Reporting `settled` with nothing in it would render
  // "nothing found" to someone whose relay list has not loaded yet, which is
  // #74: an answer about the world, given when nothing about the world is
  // known. A relay the request cannot read from is not somewhere to ask, which
  // is #78 counted from the other side.
  if (readable === 0) return 'defer';
  // Per filter, not per request. The OR array means "any of these", so one
  // satisfiable filter would be enough to justify sending — but an
  // unsatisfiable one riding along does not stay harmless: rx-nostr strips the
  // empty set field, and `{kinds:[1], authors:[]}` reaches the relay as
  // `{kinds:[1]}`, which matches everything of that kind. Measured. So an
  // unsatisfiable filter has to be dropped here (`resolveRequest` does the
  // dropping), and a request in which every filter is unsatisfiable has its
  // answer already — which is the line above the relay count.
  return 'open';
}

/**
 * A chunk handed to the query's reducer.
 *
 * `legEnded` is the sixth event of the reference machine, and it is not the
 * fifth: `closedByRelay` is a relay refusing at the protocol level, this is a
 * leg ending underneath — a send that threw, a frame that would not parse, a
 * socket that died. Protocol refusals do not end a forward subscription
 * (measured), transport failures do, and until this existed the stream simply
 * waited for an abort that might never come. The query stayed `settled` and
 * `live` while nothing could arrive on it again, which is the experience #90
 * and #83 are about.
 *
 * It carries no data because it does not change what the consumer holds. What
 * it changes is the activity axis and the diagnostics, which is the same
 * discipline C5 applies to a failed refresh: do not throw away what is on
 * screen because something behind it stopped.
 */
type ChunkBody =
  | { type: 'event'; packet: OwnedPacket }
  /**
   * The backward leg is over, with what it was missing already worked out.
   *
   * This used to be `reason: 'complete' | 'timeout'`, and the collector turned
   * that into the stored end. Two things were wrong with it and both are the
   * same thing: only the machine knows which relay did what, and one reason
   * cannot carry a timer that fired while another relay was already gone.
   */
  | { type: 'settled'; end: BacklogEnd }
  | { type: 'legEnded'; leg: 'forward'; reason: RelayLegError | undefined }
  | { type: 'refused'; refusal: Refusal };

/**
 * What the reference machine yields.
 *
 * It does not stamp the attempt, because it does not know it: one machine *is*
 * one attempt, and the id belongs to whatever decides to run another. The
 * wrapper adds the stamp on the way past.
 */
export type MachineChunk = ChunkBody & {
  readonly fresh?: boolean;
};

export type Chunk = ChunkBody & {
  /**
   * First chunk of a fresh attempt.
   *
   * The accumulated events survive a re-request (A2); what happened to the
   * previous attempt's legs must not. Without this, one `auth-required` pinned
   * the slot to `error` for the life of the cache entry, through every later
   * answer nobody refused — measured, and now P9d.
   */
  readonly fresh?: boolean;
  /**
   * Which attempt produced this chunk.
   *
   * `refresh()` promises to resolve on the outcome of the attempt *it* started,
   * and the leg table alone cannot say which attempt an end belongs to. A value
   * that already carries a finished backlog answers the next `refresh()`
   * immediately, with the previous attempt's result — measured: a live request
   * settled `complete`, its refresh was answered with `CLOSED blocked:`, and the
   * Promise resolved `complete` while the refusal was still in flight.
   *
   * Stamping the end is what makes "this attempt's outcome" expressible without
   * clearing the previous one. Clearing would work too and would be worse: the
   * primary state would drop out of `settled` for the whole of every refresh,
   * which is the thing the activity axis exists to avoid.
   *
   * The id is the caller's, not this function's. See {@link AttemptId}: a
   * `refresh()` has to know which attempt is its own before that attempt runs,
   * and something that mints on the way past cannot tell it.
   */
  readonly attempt: AttemptId;
};

export interface StreamParams {
  transport: TransportCapability;
  filters: Nostr.Filter[];
  live: boolean;
  /**
   * The relays this request is being asked of. See {@link requestTargets}.
   *
   * The resolved list rather than the `RelayScope` it came from, and that is the
   * point of it: the machine has no use for the scope's identity, and a second
   * derivation from the same value is a second chance to derive it differently.
   * The caller resolves it once — before the plan, which counts it — so the
   * request that goes out is asked of exactly the relays the request was planned
   * and keyed for.
   */
  targets: readonly string[];
  /**
   * Which attempt this is, decided before it starts.
   *
   * Supplied rather than minted here, and that is A6 landing where it belongs:
   * the caller that asked for the attempt is the only one that can know its id
   * in time to wait for it.
   */
  attemptId: AttemptId;
  /**
   * Where the attempt's lifetime is kept.
   *
   * This function stamps the attempt on the way past, and it is also the only
   * place that sees the attempt end — so it is where the end is reported. A
   * `refresh()` waiting on this id has to be told, or it waits for an outcome
   * that a torn-down consumer, a cancelled fetch or a superseded generation has
   * already made impossible. A no-op for an attempt nobody asked for by name.
   */
  attempts: AttemptRegistry;
  /** Base for the explicit rxReqIds, so the 10^6 random space is never used. */
  reqIdBase: string;
  signal: AbortSignal;
  /** Spike-only. See {@link referenceStream}'s parameter of the same name. */
  passiveAbort?: boolean;
  /**
   * The library's signature gate. See {@link referenceStream}'s parameter of the
   * same name for why verification is here rather than inside the dependency.
   *
   * Carried through rather than constructed here: the provider builds the client
   * with `skipVerify: true` and the verifier that goes with it, and those two
   * have to be decided together or the pair is a client that trusts everything.
   *
   * Required for {@link referenceStream}'s reason — an optional gate is a gate
   * that is absent whenever somebody forgets it, which is the one configuration
   * this whole change exists to make impossible.
   */
  verifyEvent: (event: Nostr.Event) => Promise<boolean>;
  /**
   * How long the backlog may take before the request settles anyway.
   *
   * rx-nostr's own `eoseTimeout` cannot be used for this: its timer is reset by
   * traffic on the merged event stream, so it does not fire in a busy app
   * (CONST-R7). Without a timer the request owns, a single relay that never
   * sends EOSE keeps a live query from ever settling.
   *
   * The number is A-γ, which is policy. What is decided is that there *is* one,
   * that it belongs to the request, and that a caller can override it.
   */
  settleTimeoutMs?: number | undefined;
}

/**
 * The relays a request may read from, resolved once and fixed for its lifetime.
 *
 * Three things used to answer this separately and could disagree: the plan
 * counted the client's readable relays, the machine built its per-relay table
 * from `getDefaultRelays()` when the stream started, and the REQ named no relays
 * at all and went wherever the client's defaults pointed at the moment it was
 * sent. The key, meanwhile, carried the scope. So a client whose defaults moved
 * from one scope to another between the key being computed and the query
 * function running put the second scope's answers under the first scope's key —
 * which is the collision B3 exists to prevent, reached from inside instead of
 * from a caller's key. `SC11`/`SC12` cannot see it: there the scope and the
 * client agree.
 *
 * So this is derived once, at the boundary, and the same array is what the plan
 * counts, what the machine's tables are built from and what the REQ is routed
 * to. Two of those agreeing is then a property of there being one value rather
 * than of two reads happening to return the same thing.
 *
 * `read: false` is not a preference the request may override — rx-nostr routes
 * REQs only to readable relays — so a client configured with nothing but
 * write-only relays has nowhere to ask, exactly as one with no relays at all.
 * Counting them as available is #78, and the scope's `urls` is already the
 * readable half for the same reason.
 *
 * **No scope means no scope was supplied, and that is a spike-only internal
 * fallback.** `scope` is optional on `UseStreamedReqOpts` because this spike
 * drives the engine directly, with no published hook to carry a provider's
 * scope into it; the intended public API has no caller who can reach the
 * branch, since `ReqDescriptor` carries neither a client nor a scope
 * (`public-entry.ts`) and the provider's own scope is not optional. Two earlier
 * versions of this sentence were both wrong in the same place: the first said
 * the branch is "the harness's case", which is too narrow — a spike caller who
 * is not the harness reaches it too — and the second called it a consumer's,
 * which is the error the other way. It is neither: it is this spike's own
 * shape, and `roles.ts` classifies `SC19`/`SC20` as regression tests for it
 * rather than as witnesses of anything a consumer can do. When it is taken, the
 * client's current defaults are the best available answer — the same fallback
 * `scopeGenerationOf` makes for the key.
 *
 * **Both branches carry the transport's name for a relay, and the second one
 * used to carry the caller's.** With a scope the name came from the transport
 * itself; here it comes from `canonicalUrl`. What comes
 * back from `getDefaultRelays()` is the caller's spelling: rx-nostr rebuilds
 * that record from each config's own `url` field, which it never normalizes
 * (`SEN25`). The machine keys its per-relay tables by whatever this returns
 * while `packet.from` carries the client's normalized spelling, so an
 * un-canonicalized target is a relay whose EOSE is attributed to nothing —
 * `SC19` is that trace, and it needs no percent-escape to reach: a trailing
 * slash is enough.
 *
 * `canonicalUrl` and not a second transformation written out here, and what it
 * gives this branch is this library's own transcription of the transport's name
 * plus a refusal for the ones the transport would rename a second time —
 * agreeing once is not enough on its own, because whatever comes out of here is
 * handed back as a target.
 *
 * **The two branches no longer answer from the same place, and this one is the
 * weaker of them.** A scope's names come from the transport itself, asked about
 * the caller's URL one relay at a time (`TransportKeys`, `TD1`), so an accepted
 * scope is a fact about the rx-nostr a consumer resolved. This branch has no
 * such answer available — there is no caller string to probe, only a client
 * somebody else configured — so it falls back to `canonicalUrl`, which is a
 * belief about a version that `SC15` checks against the one this repository
 * resolves. Being spike-only is what makes that acceptable rather than a second
 * hole: a consumer cannot reach it.
 *
 * **The refusal also arrives later here, and that is a real difference rather
 * than a wording one.** With a scope, the relay list is settled when the scope
 * is built, so a non-idempotent URL is refused before any connection, cache
 * entry or request exists (`SC21`, `SC22`). Here the client was configured by
 * whoever holds it, so the connection may already be open by the time this runs
 * and the throw lands where a request is being planned — the request is
 * refused, the connection is not this function's to prevent.
 */
export function requestTargets(
  transport: TransportCapability,
  scope: RelayScope | undefined
): readonly string[] {
  if (scope !== undefined) return scope.urls;
  // **The read throws on a disposed client, and it runs before the machine's
  // own guard does.** `getDefaultRelays()` raises rx-nostr's
  // `RxNostrAlreadyDisposedError`, so a request begun after the provider went
  // away failed here with the dependency's exception — captured as
  // `unspecified`, which is the code that means "this library cannot say" for
  // the one failure whose remedy is specific. The machine's status read was
  // guarded first and this sibling was left open: one hostile class, and the
  // repair has to reach every reader of the same client.
  const answered = transport.defaultRelays();
  const relays = answered === undefined ? undefined : Object.values(answered);
  if (relays === undefined) {
    throw ownedByLibrary(
      new InvalidDescriptorError(
        'rxNostr',
        'could not be used — this request has no usable client: either none was supplied ' +
          'with the other owner inputs, or the one supplied has since been disposed'
      )
    );
  }
  return relays.filter((relay) => relay.read).map((relay) => canonicalUrl(relay.url));
}

/**
 * The two-stage stream that the library runs.
 *
 * This used to be its own sequential implementation: drain the backlog, yield
 * the settle marker, *then* move to the forward leg. `machine.ts` records that
 * shape as a counterexample in its own header — it lets the forward queue grow
 * without bound and leaves a subscription owned by no running `for await` — and
 * the shipping path was that shape. Measured: with an empty backlog, a live
 * query stayed `loading` with zero events while forward events piled up, and
 * released them all at once when EOSE finally arrived. That is #90's symptom,
 * reproduced in the new engine.
 *
 * So the reference machine is what runs now. This is the thin part that is
 * genuinely the wrapper's: the attempt's id woven into the wire ids, and the
 * settle timeout the request owns rather than the one rx-nostr applies globally.
 *
 * **This no longer reaches an accumulator, and the round that made it a contract
 * to be an async generator is corrected here rather than left standing.** What
 * crosses A11's seam is {@link oneShotStream}'s facade, which takes an iterator
 * from this once and answers every later acquisition out of that one. So the
 * acquisition door is shut by the engine at every moment, for any producer, and
 * not by a property of this function's shape.
 *
 * What stood here was that being an `async function*` *was* the contract:
 * `[Symbol.asyncIterator]()` on a generator returns the generator itself, so
 * asking twice hands back the same object and an acquisition could open nothing.
 * **The second step does not follow.** A general `AsyncIterableIterator` may
 * return the identical object from every acquisition and open a subscription on
 * each one — identity is not absence of effect — so what the shape bought was
 * safety for *this* producer rather than a clause anything porting this could
 * rely on. That is why the guarantee moved to the engine.
 *
 * **So a rewrite that stops being an `async function*` no longer forks the
 * request**, which is the whole of what the capability bought. What such a
 * rewrite still owes is the rest: a producer whose `next()` opens a fresh
 * internal subscription per pull is not reached by any of this, because it needs
 * neither a second call nor a second acquisition. 0002's A11 carries the
 * clauses and what each is silent about.
 */
export async function* twoStageStream({
  transport,
  filters,
  live,
  targets,
  attemptId,
  attempts,
  reqIdBase,
  signal,
  passiveAbort = false,
  verifyEvent,
  settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS
}: StreamParams): AsyncGenerator<Chunk> {
  // A fresh id per attempt, and it is the attempt's own. A fixed `rxReqId`
  // produces the *same* wire subId on every fetch, because the per-subscription
  // counter restarts at 0 — measured: a refetch re-sent `m4b-b:0`, the identical
  // subId the previous fetch used. It happens to work while the previous one has
  // already been closed, but it makes correctness depend on that timing, and
  // rx-nostr silently drops a duplicate backward REQ (CONST-R2).
  //
  // The marker rides on the first chunk rather than on one of its own, because
  // a chunk of its own would write a cache value — and a value that exists is a
  // query that has left `loading`, so every attempt would begin by claiming
  // something had arrived.
  let first = true;
  try {
    for await (const chunk of referenceStream({
      transport,
      filters,
      live,
      targets,
      reqIdBase: `${reqIdBase}-${attemptId}`,
      signal,
      passiveAbort,
      verifyEvent,
      ...(settleTimeoutMs === undefined ? {} : { timeoutMs: settleTimeoutMs })
    })) {
      yield first
        ? { ...chunk, fresh: true, attempt: attemptId }
        : { ...chunk, attempt: attemptId };
      first = false;
    }
  } finally {
    // The attempt is over — by ending, by throwing, or because whoever was
    // reading it stopped. This is what replaced the wait's fixed ceiling: an
    // outcome, if there was one, is already on the value by now (the consumer
    // folds each chunk before asking for the next), so a wait that is still
    // running here is one nothing is going to answer.
    //
    // Everything the reviewer listed arrives through this line rather than
    // through a case each: a torn-down consumer aborts the signal, a cancelled
    // fetch stops pulling, a superseded generation abandons its own claim
    // first. What does *not* come through here is an attempt that never ran at
    // all, which is why the callers still check that their claim was picked up.
    attempts.abandon(
      attemptId,
      'refresh() was waiting for an attempt that ended without an answer. The ' +
        'consumer was most likely torn down, or the request it belongs to was ' +
        'replaced, while the Promise was being awaited.'
    );
  }
}
