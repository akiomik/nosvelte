/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type Nostr from 'nostr-typedef';
import type { RxNostr } from 'rx-nostr';

import type { StreamAccumulator } from './accumulate.js';
import type { AttemptRegistry } from './attempt.js';
import type { ExpiryClock } from './clock.svelte.js';
import type { ReqEvent } from './event.js';
import type {
  AnswerIdentity,
  BacklogRecord,
  CachedEventSet,
  IncompleteCauses,
  LegEnd,
  Refusal
} from './eventset.js';
import { completionOf, completionOfRecord, project, refusalsOf } from './eventset.js';
import type { Retention } from './normalize.js';
import { hardenOwned, ownedByLibrary, sealClass } from './owned.js';
import type {
  IncompleteError,
  RefreshOutcomeError,
  ReqLastError,
  ReqOutletError,
  ReqStateError
} from './reqerror.js';
import type { RelayScope } from './scope.svelte.js';

/**
 * The surface a request engine has to present, and nothing else.
 *
 * A11 is the claim that the *inside* can change while this stays fixed, and
 * until the boundary had a name the claim could only be argued rather than run.
 * Naming it makes "the door is not one-way" a thing two implementations can be
 * measured against.
 *
 * **Which boundary is the load-bearing question, and it moved.** The escape
 * route was written as "replace the inside of the wrapper with an RxJS
 * implementation", and a whole second engine was built to run it against. What
 * 0002 is actually exposed to is narrower — an `experimental_` helper reached
 * through a prerelease adapter — and a second engine with its own store is not
 * interchangeable with one over a query cache anyway, because retention across
 * unmounts, mount-time refetch and collection are all things a consumer sees.
 * The seam is {@link EngineRequest.accumulator}, and the pair it separates
 * differs only in how chunks become a value. That second engine is deleted: it
 * measured a boundary nobody is exposed to, and the interface below is what
 * survives of it — the shape a replacement has to present, whatever it is
 * built on.
 *
 * What is deliberately absent is as load bearing as what is here. There is no
 * `QueryClient`, no `queryKey`, no `raw` query object, and no accumulator- or
 * helper-specific type: C8 makes those internal details, and A11's swap stays
 * an internal one only while nothing on the published surface names them (0001's
 * backward derivation, 0004 C8). That does *not* make this the interface of a
 * TanStack-free engine — leaving the query library needs a second cache
 * implementation and is a different record.
 */
export interface EngineRequest {
  rxNostr: RxNostr;
  filters: Nostr.Filter[];
  live?: boolean;
  /**
   * The only caller-supplied input to cache identity (B2).
   *
   * It can split an entry and never merge one: two descriptors that differ only
   * here are two entries, and no value of it makes two different descriptors
   * share one. That asymmetry is the whole decision — an override would be the
   * operation 0003 rejects, and this is what is published in its place (0004's
   * `ReqDescriptor`).
   *
   * **It had reached no engine.** It was honoured by `canonicalKey`, published
   * on the consumer's descriptor, and absent from the engine's options — the
   * state 0003's own prose calls "a decision, a unit test and nothing in
   * between". The engine takes it now, and derives its key from the normalized
   * descriptor, so nothing is left for a caller to spell in by hand.
   */
  namespace?: string | undefined;
  /** Base for the explicit rxReqIds, so the 10^6 random space is never used. */
  reqIdBase: string;
  /** Where the query is running. The server never subscribes. */
  environment?: 'browser' | 'server';
  /**
   * How long the backlog may take before the request settles anyway (A-γ).
   *
   * The decision is "finite, per query, overridable"; without this field only
   * the first of the three was on the path. The number itself is policy.
   *
   * **It is part of cache identity.** Two descriptors that settle at different
   * times are not the same request — the settle marker rides on the cache value,
   * so sharing an entry between them would let whichever mounted first decide
   * when the other reports `settled`. That is the non-determinism B9 rejects.
   */
  settleTimeoutMs?: number | undefined;
  /**
   * How many events to keep, newest first (B6). Unset means unbounded.
   *
   * Bounding does not cost the fold its algebra: the fold reads no clock and no
   * bound at all, `retainNewest` reads no clock either, and the entries kept are
   * a function of the events seen rather than of their arrival order —
   * **unconditionally, at any instant**. So this is a value rather than a
   * contract, and B-ε is about what the default should be rather than about
   * whether it can exist.
   *
   * **The qualifier this used to carry is gone, and so is what it pointed at.**
   * It read "at a fixed sampled instant", on the reasoning that retention
   * prefers entries still valid at the instant each chunk sampled, so an
   * arrival sequence crossing a deadline could leave a different set. Expiry
   * left the ranking (B6, B7b): retention prefers nothing and consults no
   * deadline, `E6c` measures the opposite of what this cited it for — "the
   * bounded set is order-independent even when the clock moves between
   * arrivals" — and 0003 records the residue as closed rather than re-scoped.
   */
  retain?: Retention | undefined;
  /**
   * The clock the public projection reads (NIP-40).
   *
   * Owned by the provider: one per provider, fixed on the server, injectable in
   * tests. Absent means nothing is treated as expired, which is what the tests
   * that are not about expiry use.
   */
  clock?: ExpiryClock | undefined;
  /**
   * Where attempt ids come from (A6).
   *
   * Owned by the provider and supplied the way the clock is. Not optional, and
   * that is the difference from the clock: "no clock" has a meaning — nothing is
   * treated as expired — while an engine with nowhere to get an id would have to
   * fall back to minting its own, which is the module-global this replaced.
   */
  attempts: AttemptRegistry;
  /**
   * The relay scope this request is being made under (B-α, B3).
   *
   * Supplied the way the clock and the registry are: the provider owns it, and
   * an engine is handed the immutable value rather than reaching for the
   * client's relay list — which is untrackable (CONST-R24) and is the read B-α
   * exists to remove.
   *
   * **It is part of cache identity, and it was not on the path.** Both engines
   * that existed then passed a literal naming themselves, so `canonicalKey`
   * honoured a field that never carried a relay set: two requests under genuinely different readable
   * sets produced the same key, which is the collision B3 is written against.
   * Absent means no scope was supplied at all — see `scopeGenerationOf` in
   * `scope.svelte.ts` — which a consumer cannot reach, because there is no
   * request without a
   * provider, and which the spike's harness is in for every expectation that is
   * not about relays.
   */
  scope?: RelayScope | undefined;
  /**
   * How chunks become the cache value — **the seam A11 names** (0002 A11).
   *
   * The escape route used to be a whole second engine — `useDirectReq` over a
   * request coordinator, both now deleted — and that was the wrong joint twice
   * over. The dependency 0002 is actually exposed to is
   * `experimental_streamedQuery`, whose name says it is outside semver; the
   * TanStack cache is not what the record was worried about. And an engine with
   * its own store cannot be swapped in without a consumer noticing — it keeps a
   * value while a request is held, where a cache keeps it until GC, so mount-time
   * refetch, retention across unmounts and collection stay different however many
   * other defects are repaired.
   *
   * Moved down to here, both implementations share the client, the query
   * identity, the observer lifecycle, staleness, GC and refresh coalescing,
   * because they are the same engine. Only the accumulation differs, which is
   * the part that would have to be rewritten if the helper disappeared.
   *
   * Absent means {@link streamedQueryAccumulator} — what ships. It is on the
   * descriptor rather than fixed in the hook so that the parity suite can run
   * one set of expectations against both, which is what makes the escape route
   * a claim rather than a hope.
   */
  accumulator?: StreamAccumulator | undefined;
  /**
   * Spike-only. Makes the fold throw when it sees this event id.
   *
   * Relay-side failures do not error a stream at all — a refusal is a `CLOSED`, a dead socket is a connection state — so
   * the paths on which an attempt actually *throws* are internal ones a test
   * cannot reach from the wire.
   *
   * It buys two things that were otherwise unreachable. `refresh()` learns
   * that its attempt is over from inside the stream's own unwinding, which for
   * an attempt that threw is before the error has been recorded, so a read taken
   * in that turn reports an abort for an attempt that failed in front of it —
   * the C11 division landing on the wrong side. `X3` is the witness, and this
   * option is the only way to reach it.
   *
   * The second is the state a *failed* request is in, which is the state
   * C11-C15 is about: a request holding events whose attempt threw, re-fetched
   * like any other, resolving on the attempt this call started rather than on
   * the failure that was already recorded (`P47`, `P48`). It used to be what
   * made `refresh()` reset the entry instead of re-fetching it; that branch is
   * gone, and reaching the state is still only possible from here. That one is
   * a parity expectation: this field is on the descriptor, so both accumulators
   * fold through the same poisoned reducer.
   */
  poisonId?: string | undefined;
}

/**
 * Work in flight, kept orthogonal to {@link ReqState}.
 *
 * The primary state says what data the consumer has; this says whether anything
 * is being done about it. Mixing them is what makes "settled, and a refresh is
 * running" unrepresentable in a 4-variant union.
 */
export type QueryActivity = 'idle' | 'refreshing' | 'live';

export function deriveActivity(live: boolean, isFetching: boolean): QueryActivity {
  if (!isFetching) return 'idle';
  return live ? 'live' : 'refreshing';
}

/**
 * An answer that is not the whole answer.
 *
 * Carried as an Error because the `error` slot has to be given one, and there
 * was none: an empty timed-out request rendered `error` with `lastError`
 * undefined, so the slot's own argument could not be constructed.
 *
 * **It made the surfaces agree by being the same value, and that is what broke.**
 * This paragraph used to say the primary state, the slot and the diagnostics
 * "now report the same failure instead of three different ones", and there was
 * one way to read the slot's argument off — {@link ReqDiagnostics.lastError} —
 * so the sentence was a description of the only route rather than a property.
 * A single reachable value falsifies it: an attempt whose backlog ends refused
 * and whose forward leg then throws carries an incomplete answer *and* a
 * failure, and `lastError` is the thrown Error, so a consumer taking the slot's
 * argument from there rendered `error` for an `incomplete` state while holding
 * an Error about something else entirely.
 *
 * So the agreement is structural now instead of coincidental:
 * {@link deriveOutlet} derives the slot **and** its argument from the same
 * state, which is what the slot mapping in 0004 asks for — the argument
 * describes the state the slot came from. `lastError` answers a different
 * question, "what most recently went wrong", and the two are allowed to hold
 * different Errors because they are different facts about the same attempt
 * (`C5-C4`).
 *
 * **One object per incomplete answer** (C15). This used to be synthesised on
 * every read, in three places, so a consumer keying on it — `#key`, a memo, an
 * equality guard in an effect — saw a new object per read for the whole life of
 * an incomplete answer. The other two sources of {@link ReqDiagnostics.lastError}
 * are stable and `X4` reads one with `toBe`, so "it is derived, therefore its
 * identity is not promised" was not a position this surface could take: it was
 * already promised on two thirds of the field. See {@link incompleteErrorFor}.
 */
export class IncompleteResultError extends Error {
  /**
   * The three members `Error` gives this class, re-declared as `readonly`.
   *
   * **`B5-C8` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and inherited members are where that was
   * false**: `message`, `name` and `stack` arrive from `Error`, where they are
   * mutable, so `err.message = '[redacted]'` compiled against the emitted
   * `.d.ts` — legal-looking code the run time refuses, which is the exact
   * failure the sentence exists to prevent. `declare` makes this type-only: the
   * run time is unchanged and the modality reaches the `.d.ts`, which is where
   * `LK17` reads it, over the four classes still exported as values rather than one. (A merged
   * `interface` says the same thing and is what
   * `@typescript-eslint/no-unsafe-declaration-merging` exists to stop.)
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  /**
   * Narrowed from `Error`'s `unknown` as well as closed: what this channel
   * publishes on `cause` is another of its own values or nothing.
   */
  declare readonly cause?: undefined;

  /**
   * The literal a consumer branches on when `instanceof` cannot be trusted.
   *
   * **Added because the records said every value this library owns carries
   * one, and five classes did not** — including the two a consumer meets
   * most, and including the one `PO7` used to witness the sentence. A claim
   * that stops where its witness stops is the shape these records are about.
   */
  readonly code = 'incomplete-result' as const;

  constructor(readonly incompleteCauses: IncompleteCauses) {
    super(
      `nosvelte: the answer is incomplete (${incompleteCauses.join(', ')}). ` +
        `Some of what was asked for did not arrive, so an empty or short result ` +
        `is not evidence that nothing else exists.`
    );
    (this as { name: string }).name = 'IncompleteResultError';
    hardenOwned(this);
    // **Frozen for the reason every other published value is, and it took a
    // sweep that did not stop at the containers to see it.** This Error is
    // memoised per answer identity (C15) and handed to *every* reader of that
    // answer, so
    // it is shared by construction: a consumer writing `error.message` or
    // `error.incompleteCauses` — both `readonly` in the type, neither refused
    // at run time — changed what the next hook and the next `refresh()` read
    // out of the cache. Measured through two hooks on one key.
    //
    // Freezing keeps the identity C15 promises: `toBe` is unaffected, so the
    // "one Error per answer" contract and this one were never in conflict, only
    // untested together.
    Object.freeze(this);
  }
}
sealClass(IncompleteResultError);

/**
 * One published Error per incomplete answer, keyed on the
 * {@link AnswerIdentity} the answer's record carries (C15).
 *
 * **The key is that token, and that is the load-bearing choice.** The obvious
 * alternative — memoise per {@link CachedEventSet} — is wrong in a way that is
 * reachable rather than theoretical: a forward event folded in, or a failure
 * recorded, replaces the value and leaves the answer untouched, so a consumer
 * would be handed a new Error for a change that did not reach the
 * incompleteness. A token is minted in `endBacklog` and nowhere else, by an
 * attempt that reached an end of its own — which is exactly when the answer *is*
 * a different answer, and exactly when a new Error is right even if the causes
 * are identical. `foldEvent` and `noteFailure` spread the record through
 * untouched and `addRefusal`'s late branch puts the same token on the new record
 * it builds, so all three of those reads hit the memo.
 *
 * **What a {@link BacklogRecord} key would have cost is that third writer**, and
 * it is the argument that stood here: the claim was that no writer rebuilds the
 * record, over the population of the two that were in hand. `addRefusal`'s late
 * branch is the third and it does rebuild it, for a refusal that arrives after
 * the answer and is deliberately not a cause — so keyed on the record, an
 * ordinary `restricted:` after EOSE on a live request minted a new Error for an
 * answer nothing had changed. That is C15's own defect arriving on a wire event
 * instead of on a read, and it is measured rather than argued:
 * `the-answers-error-memo-is-keyed-on-the-record` is the ledger entry that puts
 * the key back on the record, and `X11` is the arm that dies under it.
 *
 * **A `WeakMap` rather than the alternatives**, and each was measured against how
 * these records are made and dropped:
 *
 * - A token is minted by one writer, is reachable only from the record the cache
 *   values carry, and goes with them — when a later attempt ends or the entry is
 *   collected. Nothing else holds one, so a strong `Map` would be an unbounded
 *   leak — one entry per attempt that ever ended incomplete, for the life of the
 *   process — and there is no signal this module sees that could evict it. A
 *   `WeakMap` collects with the value, which is the lifetime the answer already
 *   has.
 * - A one-slot memo (the last answer and its Error) is smaller and is wrong for
 *   a shape the library is built around: two hooks over two entries read in the
 *   same turn evict each other, so each read of either mints a new Error and the
 *   contract holds only for a page with one request on it.
 * - Storing the Error on the record itself, at `endBacklog`, would key it
 *   perfectly and costs more than it saves: `eventset.ts` would have to name the
 *   published Error class `engine.ts` declares — the import goes the other way —
 *   and every completed answer would carry a slot argument nobody asked for,
 *   inside the value A11 says an accumulator is free to rebuild.
 *
 * Module-level, deliberately, and it is not the module-global A6 rejects. That
 * one was a *source* of identity — minted ids two providers had to not share.
 * This is keyed on objects the caller already holds, so two providers cannot
 * collide in it: they have no answer token in common. Sharing it is what makes two
 * hooks over one entry hand out the same Error, which is the same reason every
 * other diagnostic is read off the value rather than held beside it.
 *
 * **The reference is still defended twice, and only one of the two is ours.**
 * Ours is the token above. The other is the query library's structural sharing — a write that
 * leaves a subtree deeply equal is given the previous subtree's reference back
 * (`replaceEqualDeep`, on unless `structuralSharing: false`, which nothing here
 * sets). Nothing here *depends* on the second: with it switched off the record
 * `foldEvent` and `noteFailure` hand back would still be the same object,
 * because neither of them rebuilds it — the writer that does is the late branch
 * above, and the token is what covers that one. It is recorded
 * because it makes a whole class of regression invisible through the published
 * handle — an edit that rebuilds the record on every write changes nothing a
 * consumer can see — so `X11` reads this property over the pure functions as
 * well, which is the only place a falsifier for it can live.
 */
const incompleteErrors = new WeakMap<AnswerIdentity, IncompleteResultError>();

function incompleteErrorFor(
  backlog: BacklogRecord,
  causes: IncompleteCauses
): IncompleteResultError {
  const memoised = incompleteErrors.get(backlog.answer);
  if (memoised !== undefined) return memoised;
  const error = ownedByLibrary(new IncompleteResultError(causes));
  incompleteErrors.set(backlog.answer, error);
  return error;
}

/**
 * What one `refresh()` did.
 *
 * `Promise<void>` could not say. The three shapes below are things a consumer
 * acts on differently, and the alternative — inspecting the state afterwards —
 * cannot tell this attempt's result from the next one's.
 *
 * A refusal or a timeout is not an exception: the attempt happened and came
 * back partial, so it resolves as `incomplete` rather than rejecting. Rejection
 * is for failures of the call itself — a descriptor the boundary refuses, a
 * disposed provider, an abort while it was running. And `not-started` is kept
 * apart from an empty `complete` for C12's reason: "nothing came back" and
 * "nothing was asked" are the distinction the whole slot mapping rests on.
 */
/**
 * The outcome of an attempt, read off the value it produced.
 *
 * Shared, because `refresh()` has to answer the same way on both accumulators and
 * the answer is a function of the same three things: whether the attempt failed,
 * whether the backlog finished, and what it was missing if it did not.
 *
 * `error` is the caller's decision rather than the entry's status. It used to be
 * "whatever error the query is holding", which is only this attempt's if the
 * previous one was cleared when this attempt started; the failure is stamped on
 * the value now, so the caller matches it by id and passes it here only when the
 * failure it matched is the one being reported. See `backlogOutcome`.
 */
export function outcomeOf(
  data: CachedEventSet | undefined,
  error: RefreshOutcomeError | undefined
): RefreshOutcome | undefined {
  // **Frozen, because two callers are handed the same object.** `refresh()`
  // resolves every waiter of one attempt with one outcome — `P38` asserts that
  // identity with `toBe`, and two components on one key are two callers — so a
  // consumer writing `outcome.kind = 'error'` changed the discriminant the
  // *other* caller read. Measured. The type says every member is `readonly`;
  // that is a TypeScript rule and cuts no run-time write, which is the same
  // gap the events and the diagnostics rows closed.
  if (error !== undefined) return Object.freeze({ kind: 'error', error } as const);
  if (data === undefined) return undefined;
  const completion = completionOf(data);
  if (completion === undefined) return undefined;
  return completion.kind === 'complete'
    ? Object.freeze({ kind: 'complete' } as const)
    : Object.freeze({ kind: 'incomplete', causes: completion.causes } as const);
}

// **Readonly on every member, for the reason the values are frozen.** A type
// that permits a write over a frozen value is legal-looking code that fails at
// run time, which this record calls worse than the defect it would be hiding —
// and the union's discriminants were the half that got missed when the rule was
// applied to the containers. `LK16` counts them now.
export type RefreshOutcome =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly causes: IncompleteCauses }
  | { readonly kind: 'error'; readonly error: RefreshOutcomeError }
  /**
   * The call was made, and something ended it that is not a failure of the
   * request.
   *
   * **Lifecycle cancellations are a value, not a rejection**, and this is the
   * whole of that change. `onclick={() => handle.refresh()}` is what an
   * application writes for a retry button; a consumer navigating away from a
   * slow feed used to make that line produce an **unhandled promise
   * rejection**, for a case where nothing went wrong — and the rejected value
   * was deliberately untypeable, so a consumer had to handle failures in two
   * places with two disciplines for one call.
   *
   * The promise is bounded and the bound is stated: what moves here is the
   * *lifecycle* — the consumer's root released, the provider disposed while the
   * call was in flight. A failure the attempt itself answered is still the
   * `error` outcome, and a caller's own exception is not promised never to
   * reject.
   */
  | {
      readonly kind: 'cancelled';
      readonly reason: 'consumer-released' | 'provider-disposed';
    }
  | {
      readonly kind: 'not-started';
      /**
       * Which "nothing was asked" this is, and the three are not the same
       * remedy: `server` is the side the render is on, `no-readable-relay` is
       * the provider's list — or a request that named an empty target set on
       * purpose — `deferred` is the caller's own plan, which they change by
       * asking, and `released` is a handle whose root is gone, which nothing
       * changes: it is the one reason with no remedy, because the thing that
       * would act on the answer is not there.
       *
       * `released` is kept apart from `cancelled` by **when**: a call made on a
       * handle that was already released never started, and a call that was in
       * flight when the root went away was cancelled.
       */
      readonly reason: 'server' | 'no-readable-relay' | 'deferred' | 'released';
    };

export type ReqState =
  | { readonly status: 'loading' }
  | { readonly status: 'streaming'; readonly events: readonly ReqEvent[] }
  /**
   * The backlog ended and brought everything it was going to bring.
   *
   * **`hasMatchEvidence` says whether this request ever accepted an event, and
   * it is on the state because the slot depends on it.** C12 makes `nodata` an
   * assertion about the world — "nothing found" — rather than a statement that
   * the list is empty, and an answer that accepted events and is showing none of
   * them at this instant is not evidence for it. The two values are otherwise
   * identical: nothing on {@link CachedEventSet} records that an entry was
   * received and discarded, so "asked and told nothing exists" and "received
   * four and can show none" reach the same `events: []` and could not be told
   * apart from the list (`EX6b`).
   *
   * **It is named for what it means and not for where it is read.** It was
   * `holdsEntries`, which is a sentence about this accumulator's storage, and
   * A11 keeps the accumulator swappable: an implementation that stores its
   * events some other way, or evicts them, would have had to answer a question
   * about a `Map` it does not have. What every implementation is asked instead
   * is whether the request found anything — **true once this request has
   * accepted an event in A-ε's sense of the word, which is two clauses and not
   * three: past the signature gate, and past it before the wait that event's
   * leg belonged to ended. It does not go back to false because the value later
   * dropped what it accepted.**
   *
   * **A third clause stood in that sentence — "one its filters asked for" — and
   * it is a true statement about which arrivals can become evidence rather than
   * part of the definition.** A-ε owns the word and states it in two clauses;
   * restating it in three here is the paraphrase that rule exists to stop, and
   * it is redundant besides — an event this request's filters did not ask for is
   * dropped by rx-nostr before it reaches the gate, so it cannot pass one. The
   * check that drops it is the dependency's own and this library leaves it on:
   * the provider takes exactly three configuration options and
   * `skipValidateFilterMatching` is not among them (`WR13`). `EV2`'s `unasked`
   * arm measures the consequence — `false` and `nodata` — and not the clause.
   *
   * Today "the request accepted an event" and "the stored set is non-empty"
   * coincide and that is measured rather than assumed: the fold only ever
   * adds or replaces, `retainNewest` keeps `min(retain, size)` entries
   * with `retain` at least 1, and a `retain: 0` descriptor is refused before a
   * REQ goes out — so no bound can empty a set that accepted anything, and this
   * variant is unreachable with `retain: 0` (`EV1`, `EV3`).
   *
   * **`false` is not the claim that no relay sent anything**, and the boundary
   * is deliberate. Events the verifier rejects and events the request's own
   * filters did not ask for are dropped and are not evidence (`EV2`): counting
   * arrivals instead would let any relay suppress a truthful "nothing found" by
   * sending one unverifiable event, which is the one thing a claim about the
   * world must not be reachable by. What the consumer gets on that route is the
   * `nodata` slot, and the events that would have earned `default` are the ones
   * the request accepted.
   *
   * **A third route reaches `false` the same way, and it is what the boundary
   * clause above is for**: a matching event still being verified when its leg's
   * wait was cut never became `accepted`, so it is discarded and the verifier
   * answering `true` afterwards changes nothing. That discard is reported by
   * {@link ReqDiagnostics.legEnded} and by nothing finer — a per-candidate
   * field would be a marker any relay could attach to a truthful "nothing
   * found" by sending one event it never lets verify. A-ε decides that silence
   * and carries its falsifier; `EV4` measures both of its directions.
   *
   * **It is a boolean rather than a count, and that is B-θ and not economy.**
   * B-θ is narrowed to the counts and the reasons — how many were hidden, how
   * many the bound discarded, which of the two emptied the list — and its
   * falsifier still fires on a count of what expiry hid published without one of
   * what the bound discarded, the half-answer that reads as "nothing else was
   * lost". A count here would be exactly that half, since {@link project}
   * withholds only on a deadline while the bound's evictions leave no trace at
   * all. One bit saying the request found something is not that half: it is the
   * only thing the slot asks, and the narrowing is written into B-θ rather than
   * left as a field that quietly outgrew it.
   *
   * It is read off the same {@link CachedEventSet} that produced `events`, in
   * the same read, which is the whole reason it is a field here rather than a
   * second parameter to {@link deriveOutlet}. Passed separately it would have
   * to come from a second read of {@link ProjectedRead.projected} — the two-getter
   * disagreement that getter exists to prevent — and it would take
   * {@link deriveSlot} with it, which is documented to answer from the state
   * alone.
   *
   * Only this variant carries it, because only this variant's slot turns on
   * it. A `streaming` value hiding everything renders `loading` and an
   * `incomplete` one renders its causes; both are honest about a request that
   * is unfinished or partial, and neither claims anything about the world.
   */
  | {
      readonly status: 'settled';
      readonly events: readonly ReqEvent[];
      readonly hasMatchEvidence: boolean;
    }
  /**
   * The backlog is over and did not bring everything.
   *
   * The fifth variant, and the four before it were what made the same fetch
   * look like a success or a failure depending on how many events happened to
   * arrive: a timeout with one event reported `settled` and rendered `default`,
   * the same timeout with none reported `settled` and rendered `error`. The
   * incompleteness is a property of the fetch, not of its size.
   *
   * **`error` is here so that it can be one object** (C15). It is the same
   * incompleteness the causes name, in the shape the `error` slot has to be
   * handed, and it is carried on the state rather than built by whoever needs
   * it because that is what makes it a *reference* rather than a description:
   * {@link deriveOutlet} and {@link deriveDiagnostics} both read this field, and
   * both used to construct their own. Its lifetime is the answer's, not the
   * value's — see {@link incompleteErrorFor}.
   */
  | {
      readonly status: 'incomplete';
      readonly events: readonly ReqEvent[];
      readonly causes: IncompleteCauses;
      readonly error: IncompleteError;
    }
  /**
   * `events` is always empty here today, and the field is present anyway.
   *
   * This state is only reached when there is nothing usable to show — a failure
   * over data already on screen stays on the diagnostics axis instead, which is
   * C5. Keeping the field means every state that is not `loading` answers the
   * same question the same way, so a consumer never has to ask which shape it
   * is holding before reading the events.
   */
  | {
      readonly status: 'error';
      readonly events: readonly ReqEvent[];
      readonly error: ReqStateError;
    };

/**
 * The mapping from what an engine observes to the primary state.
 *
 * Total, and shared by every accumulator, so "the same descriptor produces the same
 * state" is a property of one function rather than a coincidence between two
 * implementations. Note it never consults whether a fetch is in flight —
 * `settled` comes from the cache value, because for a live query the promise
 * never resolves and `fetchStatus` would say 'fetching' forever.
 */
export function deriveState(
  observed: { data: CachedEventSet | undefined; error: ReqStateError | undefined },
  now: number | undefined
): { state: ReqState; nextExpiryAt: number | undefined } {
  // **Frozen at the one exit rather than at five `return`s.** Everything a
  // request publishes is the consumer's to hold and nobody else's — the events,
  // the causes, the refusals, and the object carrying them — and the rule was
  // repaired value by value until a walk over what a hook publishes counted the
  // ones nobody had thought about (`PO1`). A container is frozen where it is
  // built; this is where the state object is.
  const derived = deriveStateOf(observed, now);
  return { ...derived, state: Object.freeze(derived.state) };
}

/**
 * The events of a state that has none.
 *
 * **Frozen and shared, because the two `error` branches built a fresh `[]`
 * each.** `deriveState` freezes the state object it publishes and that stops at
 * its own members: the array inside was a consumer's to push into, on the one
 * status where nothing else was. Measured by walking a failed attempt's state —
 * the branches that project their events were already frozen by `project`, so
 * this was the only mutable array a published state could carry, and it was on
 * the two branches no ownership sweep had a value for.
 */
const NO_EVENTS: readonly ReqEvent[] = Object.freeze([]);

function deriveStateOf(
  observed: { data: CachedEventSet | undefined; error: ReqStateError | undefined },
  now: number | undefined
): { state: ReqState; nextExpiryAt: number | undefined } {
  // The value's record first, the entry's error as the fallback for the one
  // failure class that cannot have a record — see {@link ReqDiagnostics.lastError}.
  const failure = observed.data?.failure?.error ?? observed.error;
  // No value at all: there is nothing to project and nothing to be missing, so
  // a failure here is the whole of what there is to report and its absence is
  // still `loading`. This is the one branch that can answer before projecting,
  // because it is the one where there is nothing to project.
  if (observed.data === undefined) {
    return failure === undefined
      ? { state: { status: 'loading' }, nextExpiryAt: undefined }
      : { state: { status: 'error', events: NO_EVENTS, error: failure }, nextExpiryAt: undefined };
  }

  // One projection, read once, so the events and the status a consumer holds
  // describe the same instant. Two getters over the same value would let a
  // caller read `settled` and then read a list from a later generation.
  //
  // Read *before* the failure branch rather than after it, which is the order
  // that changed: that branch asks whether there is anything to show, and what
  // a consumer can be shown is this list. Asking it first meant asking it of
  // the stored set, and the two answers differ (see below).
  const { events, nextExpiryAt } = project(observed.data, now);
  // The completion **and the record it was read off**, bound together by one
  // read. Present exactly when the backlog has ended, which is what
  // `completionOf` answers `undefined` for.
  //
  // A pair rather than a `Completion`, because the record is the key the
  // published {@link IncompleteResultError} is memoised on (C15) and the memo
  // may only be given the record this answer came from. Written as
  // `observed.data.backlog` beside a separate `completionOf(observed.data)`,
  // those are two reads of one value with nothing saying they saw the same one.
  const backlog = observed.data.backlog;
  const answer =
    backlog === undefined ? undefined : { backlog, completion: completionOfRecord(backlog) };

  // Is there anything on the value a consumer can be shown?
  //
  // The question `data === undefined` used to ask, and cannot any more. A
  // failure is recorded *on* the value now ({@link CachedEventSet.failure}), so
  // a request that failed before anything arrived holds a value whose only
  // content is the failure — and the old guard would take that for an answer
  // and report `streaming` with an empty list, which renders the loading slot,
  // for as long as the failure stands.
  //
  // Two things count as something to show, and the second is why this is not
  // the list on its own: the events **as projected at this instant**, or an
  // answer about their absence. A backlog that ended is `settled` or
  // `incomplete` with its causes, both of which a consumer renders, so a later
  // failure over one belongs on the diagnostics axis by exactly the rule C5
  // states for a list. A completed empty answer therefore stays an answer.
  //
  // **That last sentence is a decision, and it lived only here for a round.**
  // It is `C12-C3` now, with witnesses, because it decides what `nodata` means:
  // an empty answer is retracted neither by a later attempt failing nor by its
  // events reaching their deadlines. The argument is C5's own, applied to a
  // list of length zero — a failed refresh must not empty a list of three, so it
  // must not empty a list of none either, and treating them differently is the
  // same "how visible the failure is depends on how many events happened to
  // arrive" that the fifth state exists to remove (`P20`). What a consumer is
  // told instead is on the axes that own it: the failure on the diagnostics,
  // and `idle` on the activity axis.
  //
  // **The projection and not `entries.size`**, and that is a reversal. Reading
  // the stored set made this line clock-free, and the corner it was traded for
  // was not a corner: an unfinished attempt that failed while holding one
  // event, whose event then expired, still counted the event it can no longer
  // show. The state was `streaming` over an empty list — the loading slot —
  // with nothing being fetched and a failure recorded, which is precisely what
  // C5's error branch exists to prevent, reached through C13 instead of through
  // the failure record. Nothing was bought by avoiding the clock: this function
  // already takes `now` and already projects, and the events it reports are the
  // projected ones on every other path, so the primary state was time-dependent
  // in every branch but this one. The stored events are untouched — nothing
  // evicts them — so a corrected clock brings both them and the state back,
  // which is why "nothing to show at this instant" is still not the same claim
  // as "nothing was received".
  const hasAnswer = events.length > 0 || answer !== undefined;

  // `error` only when there is nothing usable to show. A background refresh
  // that fails while a settled list is on screen used to take the whole state
  // to `error`, and a consumer choosing its slot from the status would drop the
  // events it was already displaying — measured, and the reason C5 exists. The
  // failure is not lost: it stays on the diagnostics axis.
  //
  // `nextExpiryAt` is the projection's, on this path as on every other. It is
  // provably `undefined` here — the deadline reported is the nearest one *among
  // what is shown*, and nothing is shown — so this schedules no wake-up, and
  // that is the right answer rather than a lucky one: nothing about an error
  // state changes at a deadline. The wake-up that carries a request *into* this
  // state was armed one branch down, while the event was still projected and
  // the state was still `streaming`. Writing the projection's field rather than
  // a literal keeps one source for the deadline: a state and a deadline read
  // off different things is the disagreement the single projection above exists
  // to remove, and hard-coding `undefined` would be a second claim that has to
  // be re-derived every time `project` changes.
  if (failure !== undefined && !hasAnswer) {
    return {
      state: { status: 'error', events: NO_EVENTS, error: failure },
      nextExpiryAt
    };
  }

  if (answer === undefined) return { state: { status: 'streaming', events }, nextExpiryAt };
  if (answer.completion.kind === 'incomplete') {
    return {
      state: {
        status: 'incomplete',
        events,
        causes: answer.completion.causes,
        error: incompleteErrorFor(answer.backlog, answer.completion.causes)
      },
      nextExpiryAt
    };
  }
  // `hasMatchEvidence` is read off the same value as `events`, so the two cannot
  // describe different instants. `entries` is everything the value holds and
  // `events` is what `project` kept of it at this instant; the slot asks only
  // whether there was anything to keep — see the `settled` variant for why it
  // asks that and not how many were withheld, and for why "what this
  // accumulator still holds" is a sound derivation of "what the request
  // accepted" rather than a second meaning.
  return {
    state: { status: 'settled', events, hasMatchEvidence: observed.data.entries.size > 0 },
    nextExpiryAt
  };
}

/**
 * The axis that carries what went wrong, separately from what is on screen.
 *
 * Every field is read off the cache value rather than held beside it. That is
 * not tidiness — held per hook, these were the inputs to a slot that two
 * consumers of one cache entry could disagree about, and twice they were carried
 * across a descriptor change as well (P16, P18/P18b). Derived from the value,
 * both defects are unreachable: the cache key decides which request a record
 * belongs to, and it is the same record every consumer reads.
 *
 * `lastError` was the exception to that sentence and is not one any more. It was
 * read off the query entry, on the reasoning that a query which failed has no
 * value to carry the failure — which stopped being true when a failure started
 * writing one ({@link CachedEventSet.failure}). What is left of the exception is
 * one fallback, named on the field itself.
 */
export interface ReqDiagnostics {
  /**
   * The most recent failure, until a *later* attempt that ends supersedes it.
   *
   * The rule in one line: a failure appears when an attempt throws, stays while
   * later attempts start and run, and is cleared by the first **later** attempt
   * that reaches a backlog end. A new attempt starting clears nothing, because
   * while it runs the previous failure is still the most recent failure there
   * has been — the contradiction between this field's name and its lifetime is
   * what r11 opened as a blocker, and the id stamped on
   * {@link CachedEventSet.failure} is what makes attribution work without
   * clearing.
   *
   * "Later" is the word this summary left out for two rounds, and the exception
   * it hides is contracted (`B10-C6`) and witnessed (`E17b`): an end does not
   * clear a failure stamped with the attempt that *reached* it. A failure is
   * the last thing an attempt writes, so a same-attempt failure is what
   * happened after that answer rather than evidence against it, and dropping it
   * would delete the newer of the two facts. See `endBacklog`.
   *
   * One failure class has no record and is read off the query entry instead: a
   * descriptor the boundary refused. It never reaches an attempt, so there is
   * nothing to stamp — and it cannot collide with a request that has a value,
   * because `resolveRequest` puts it on a key of its own
   * (`['nosvelte', 'refused', namespace, generation, message]`, five elements,
   * against the two of `['nosvelte', canonicalKey]`), so the entry holding it
   * never holds a value. The namespace and the generation are on it because
   * `ReqDescriptor.namespace` is published as partitioning the cache — "it can
   * only split, never merge" — and keying a refusal on its wording alone was
   * the one place that sentence was false.
   *
   * An incomplete answer synthesises an {@link IncompleteResultError} here, and
   * the reason is no longer "the `error` slot has to be given an Error" —
   * {@link deriveOutlet} constructs the slot's argument from the state now, so
   * that one is answered where it is asked. What is left is this field's own
   * meaning: when nothing threw, the answer coming back partial *is* the most
   * recent thing that went wrong, and a field that reported nothing would be
   * saying the request is fine.
   *
   * **It is a fallback and not the slot's argument, and the difference is
   * reachable.** An attempt can end refused and then throw, and then the two
   * disagree on purpose: the state is `incomplete`, the error slot is handed an
   * `IncompleteResultError` naming its causes, and this field holds the Error
   * that was thrown, because that is what most recently went wrong. Reading the
   * slot's argument off here is what made that value render `error` with an
   * Error describing something else (`C5-C4`).
   *
   * The order is by recency and can be read as such. A failure that survives is
   * always the ending attempt's own or a later one's — `endBacklog` drops every
   * other — so a record on the value is never older than the completion beside
   * it.
   */
  readonly lastError: ReqLastError | undefined;
  /**
   * Set once the forward leg has ended, with the reason if there was one.
   *
   * The sixth event moves the activity axis, which tells a consumer that nothing
   * is being done — but not that nothing *can* be done. Without this, a request
   * whose leg died looks exactly like one that settled normally and went quiet.
   */
  readonly legEnded: LegEnd | undefined;
  /** Every relay that refused, with what it said. A5's fifth event. */
  readonly refusals: readonly Refusal[];
}

export function deriveDiagnostics(
  state: ReqState,
  value: CachedEventSet | undefined,
  entryError: ReqStateError | undefined
): ReqDiagnostics {
  const data = value;
  // Frozen for `deriveState`'s reason: what a consumer holds is theirs, and the
  // object around the values counts as much as the values.
  return Object.freeze({
    // The value's record first. It outlives the start of the next attempt,
    // which the entry's error does not — query-core clears that at the start of
    // a fetch whenever the entry holds no data (SEN22) — so reading the entry
    // first would put the field back on the lifetime its name contradicts.
    //
    // The third source is a fallback, not the slot's argument, and this comment
    // used to say the opposite: "an incomplete answer reports the same failure
    // here that the primary state reports". The primary state reports causes
    // rather than an Error, and the sentence was true only of the values where
    // nothing had thrown — which is every value the witnesses that assert it
    // build. Where an attempt answers incompletely *and* throws, this field is
    // the throw, deliberately: it is the most recent failure. What the error
    // slot is handed comes from {@link deriveOutlet}, off the state, so the two
    // surfaces cannot be made to disagree by whatever is on this axis.
    //
    // The third source is **read** rather than constructed, and that is C15.
    // Synthesised here, this field handed back a new object on every read for
    // the whole life of an incomplete answer, while its other two sources are
    // references — so a consumer keying on it saw churn that depended on which
    // source happened to be filling it. The state carries the one object for
    // this answer, and the error slot is handed the same one.
    lastError:
      data?.failure?.error ??
      entryError ??
      (state.status === 'incomplete' ? state.error : undefined),
    legEnded: data?.forward?.end,
    refusals: refusalsOf(data)
  });
}

/** What a component renders. Four slots, as the current components have. */
export type Slot = 'loading' | 'error' | 'nodata' | 'default';

/**
 * What one outlet is: which slot renders, and what it is handed.
 *
 * The `error` slot takes an Error and the other three take no argument of their
 * own, so this is the whole of 0004's slot table rather than its first column.
 *
 * **A discriminated union, because the claim is that the slot and its argument
 * cannot disagree.** As `{ slot: Slot; error: Error | undefined }` that claim
 * was a property of {@link deriveOutlet}'s body: `{ slot: 'loading', error }`
 * and `{ slot: 'error', error: undefined }` were both constructible, so the two
 * halves of the table could come apart in any future edit and nothing but a test
 * would say so. Written this way the compiler rejects both, which is the same
 * move the fifth `ReqState` variant and the absent `settled` flag make one layer
 * down: the shape says it, so nothing has to remember to.
 */
export type Outlet =
  | { readonly slot: 'error'; readonly error: ReqOutletError }
  | { readonly slot: 'loading' | 'nodata' | 'default'; readonly error: undefined };

/**
 * The mapping from state to slot **and to the slot's argument**, total by
 * construction.
 *
 * One argument, and that is the point of it. `nodata` asserts that nothing
 * exists, and only a request that finished and heard from everyone can say
 * that — which is what `settled` now means, so the mapping reads the state
 * rather than re-deriving the condition.
 *
 * | primary      | entries | slot      | slot argument           |
 * | ------------ | ------- | --------- | ----------------------- |
 * | `loading`    | —       | `loading` | none                    |
 * | `streaming`  | none    | `loading` | none                    |
 * | `streaming`  | some    | `default` | `T`                     |
 * | `settled`    | some    | `default` | `T`                     |
 * | `settled`    | none, hiding | `default` | `T`                |
 * | `settled`    | none, empty  | `nodata`  | none               |
 * | `incomplete` | some    | `default` | `T`                     |
 * | `incomplete` | none    | `error`   | `IncompleteResultError` |
 * | `error`      | —       | `error`   | `error`                 |
 *
 * `T` is the component's outlet argument (0004): `{ events: readonly
 * ReqEvent[]; state: ReqState }` for the three list components and
 * `{ event: ReqEvent; state: ReqState }` for the other eight. This column
 * said `events`, `status` — the vocabulary of the components being replaced,
 * whose `ReqStatus` this surface does not publish, and which eight of the
 * eleven do not hand over under either name.
 *
 * **The second column was decided in 0004 and derived nowhere**, which is the
 * defect this function exists to close. `deriveSlot` answered the first column
 * and the only published Error was {@link ReqDiagnostics.lastError}, so a
 * component had one place to reach for the `incomplete` row's argument — and on
 * a value whose attempt answered incompletely *and* threw, that place holds the
 * throw. The state said `incomplete`, the slot said `error`, and the Error
 * handed to it described a different fact about the same attempt. Both facts
 * are true and neither is the other's; what was wrong is that one field was
 * being asked both questions.
 *
 * So the argument is derived from the state, beside the slot and by the same
 * `if`s, and the two cannot disagree about which state they came from whatever
 * else the value carries. That is also C7's rule one level down: a component
 * does not hold its own copy of the mapping, and it does not construct its own
 * argument either.
 *
 * An incomplete answer with something in it still renders what it has — the
 * same discipline that keeps a failed background refresh from clearing the
 * list. What tells the consumer it is partial is the status and the
 * diagnostics: the status carries the causes, and the diagnostics carry
 * whatever most recently went wrong, which on that row is not necessarily the
 * same Error (`C5-C4`).
 */
export function deriveOutlet(state: ReqState): Outlet {
  if (state.status === 'error') return { slot: 'error', error: state.error };
  if (state.status === 'loading') return { slot: 'loading', error: undefined };
  if (state.events.length > 0) return { slot: 'default', error: undefined };
  if (state.status === 'streaming') return { slot: 'loading', error: undefined };
  // `nodata` is the claim that nothing exists, so it is not enough that the
  // list is empty — the request must have accepted nothing either. An answer
  // holding entries it is currently hiding renders the default slot over its
  // empty list instead: that shows the consumer the same nothing, without
  // asserting a world it has evidence against. See C12 and `EX6b`.
  if (state.status === 'settled')
    return { slot: state.hasMatchEvidence ? 'default' : 'nodata', error: undefined };
  // Read off the state, exactly as the `error` row above is.
  //
  // This line used to *build* an `IncompleteResultError` from `state.causes`,
  // which put the argument's identity on the reader's side of the boundary: the
  // slot was handed a new object per read, so a `#key` or an equality guard
  // churned for the whole life of an answer that had not changed. The state
  // carries the one Error for this answer now (C15), and the only difference
  // between this row and the `error` row is which state it came from.
  return { slot: 'error', error: state.error };
}

/**
 * The slot alone, for the readers that only choose a branch.
 *
 * Derived from {@link deriveOutlet} rather than written a second time: two
 * functions over one table is how a slot and its argument come to describe
 * different states, which is the defect above.
 */
export function deriveSlot(state: ReqState): Slot {
  return deriveOutlet(state).slot;
}

/**
 * The mount-time trigger, decided rather than inherited (A13).
 *
 * A hook mounting over a request that is already there should join it, and a
 * hook mounting over one nobody is holding should re-ask. Inherited, those two
 * are one setting with no answer: `refetchOnMount: true` makes the second hook
 * on a settled entry send a REQ nobody asked for — a new attempt, and the first
 * hook's `activity` flipping to `refreshing` because somebody else mounted —
 * while `false` (or `staleTime: 'static'`) buys that back by making a remount
 * silent, which for a live request means never re-subscribing (A4-C1, M6b).
 *
 * The observer count tells the two apart, and it can only do so because of the
 * order query-core mounts in: `onSubscribe` calls `addObserver(this)` and
 * *then* asks `shouldFetchOnMount`, so the count already includes the observer
 * being mounted. `1` is therefore "nobody else is on this entry" — a first
 * mount or a remount after the last holder let go — and anything above it is an
 * existing request to join.
 *
 * That order is a fact about the dependency, not about us, and so are the other
 * three this rests on: that a function here is called with the `Query`, that
 * its answer is only honoured while the entry is *also* stale, and that a query
 * with no data loads regardless of what this returns. `SEN21` pins all four
 * against the resolved copy.
 */
export function refetchOnMountUnlessJoining(query: { getObserversCount: () => number }): boolean {
  return query.getObserversCount() === 1;
}

/**
 * How long an entry nobody is observing stays reusable, in a browser.
 *
 * Named rather than written inline because it is the number
 * `A13-C3`'s "before the entry is collected" is relative to, and it was decided
 * by the dependency until this round: `gcTime` was simply absent, so five
 * minutes arrived as an inheritance rather than as a decision.
 */
const BROWSER_GC_TIME_MS = 300_000;

/**
 * The options this library owns, as a function of the one fact the provider has
 * already resolved.
 *
 * **`gcTime` cannot be a constant here**, and that is the whole reason this is a
 * function: query-core's own default is 300 000ms in a browser and `Infinity` on
 * a server, and writing the browser number into a shared table would arm a GC
 * timer on the server arm — where the decision is that nothing is created that
 * would need releasing. So the environment decides it, the way it decides the
 * clock and the transport.
 *
 * **`networkMode: 'always'`** is the other addition, and it is a decision about
 * what `refresh()` means. Left unset it resolves to `'online'`, and an offline
 * fetch is then *paused*: no attempt begins, `refresh()` rejects — measured, with
 * a message whose halves were both false — and the ask goes out later, under a
 * new attempt, delivering to a caller whose promise had already rejected. The
 * alternative to `'always'` is a fourth lifecycle, a queued intent with no
 * attempt behind it, which splits `C11` again. With `'always'` the query layer
 * does not stand between a `refresh()` and an attempt: the socket is rx-nostr's
 * to own, and being unable to reach a relay is what `timeout`, `ended` and
 * `incomplete` already say. **What is contracted is that an attempt starts**,
 * not that a frame leaves the machine.
 */
export const libraryQueryDefaults = (environment: 'browser' | 'server') => ({
  ...LIBRARY_QUERY_DEFAULTS,
  networkMode: 'always' as const,
  gcTime: environment === 'server' ? Number.POSITIVE_INFINITY : BROWSER_GC_TIME_MS
});

export const LIBRARY_QUERY_DEFAULTS = {
  retry: 0,
  /**
   * The other half of {@link refetchOnMountUnlessJoining}, and not an
   * independent choice.
   *
   * `shouldFetchOn` only reaches the predicate's answer through
   * `isStale(query, options)` — it returns `value === 'always' || (value !==
   * false && isStale(...))`, and with `staleTime: 'static'` it returns before
   * calling the predicate at all. So a non-zero staleTime here would not soften
   * the trigger, it would switch it off: the predicate would go on answering
   * `true` for a remount and nothing would fetch, which is the live request that
   * never re-subscribes again. The two options are one joint. `SEN21` measures
   * the joint rather than the option, for exactly that reason.
   *
   * Written out even though it is query-core's own default, because the default
   * is upstream's to change and this decision is not.
   */
  staleTime: 0,
  refetchOnMount: refetchOnMountUnlessJoining,
  // A13: the freshness triggers are decided rather than inherited.
  //
  // Not for the reason recorded here before. "A live query is permanently
  // fetching, so a focus-driven refetch would cancel the running stream and
  // open it again" is wrong on the measurement: query-core's focus path fetches
  // without `cancelRefetch`, and a query already fetching hands back the
  // running promise — a live request with the trigger turned all the way on
  // sends no second REQ. The live case is immune whatever this says.
  //
  // Where it decides anything is a *settled* request, which is stale the moment
  // it settles. Without these, returning to the tab re-opens every request on
  // screen, and each one is a REQ to every relay in scope.
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false
} as const;

/** What the engine exposes beyond the published handle. Not part of 0004. */
export interface ProjectedRead {
  readonly projected: { state: ReqState; nextExpiryAt: number | undefined };
}

/** What a consumer holds, whichever engine produced it. */
export interface ReqHandle {
  readonly state: ReqState;
  readonly activity: QueryActivity;
  readonly diagnostics: ReqDiagnostics;
  /**
   * Ask again. Resolves on a new answer, or on a new failure.
   *
   * One meaning, whatever the request: start a new backward attempt, keep the
   * events already held, and resolve on *that* attempt's outcome. There is no
   * shortcut for a healthy live request — this interface used to say one
   * resolved immediately, on the reasoning that its leg was already open, and a
   * call that returns having done nothing is the worst edge an API can have. A
   * request that has stopped, whether it failed outright or its leg ended
   * underneath it, is re-opened whether or not it is live. Without that, the
   * only way back from either state was to unmount, since retry is off by
   * decision.
   *
   * Two calls made at once over one request are one attempt on *either* side of
   * A11's seam, and both callers are handed the same outcome object — C11's
   * contract, and `P38` asserts it on both. This doc said the opposite for two
   * rounds after the engines were made single-flight, which is why the sentence
   * now names the unit: a **request**.
   *
   * Two *hooks* asking the same question are also one request (`P42`), and that
   * used to be where the two implementations differed — one had an entry to
   * share them on and the other did not. It is not a difference any more:
   * {@link EngineRequest.accumulator} is the seam now, and both sides of it run
   * on the same cache entry. Nothing here gives a caller an outcome belonging to
   * an attempt of a request it did not ask for.
   *
   * **A property, not a method**: TypeScript declares a method as an
   * assignable slot, so `handle.refresh = …` compiled against this interface —
   * and the run time took it too, because the handle was not frozen, so one
   * consumer's replacement was every later reader's `refresh`. Declared
   * `readonly`, the slot is refused by the type; the handle is sealed, so the
   * write is refused at run time however it is spelled; and the call is the
   * same call. The members TypeScript declares on every function — `call`,
   * `prototype`, `caller` and the rest — stay assignable in those declarations,
   * the exception `B5-C8` states, and the sealed function refuses them at run
   * time.
   */
  readonly refresh: () => Promise<RefreshOutcome>;
}
