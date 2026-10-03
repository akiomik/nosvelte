/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type Nostr from 'nostr-typedef';
import type { RxNostr } from 'rx-nostr';
import { createQuery, hashKey, QueryClient, type QueryKey } from 'tanstack-svelte-query-v6';

import type { StreamAccumulator } from './accumulate.js';
import { streamedQueryAccumulator } from './accumulate.js';
import type { AttemptId, AttemptRegistry } from './attempt.js';
import { AccumulatorContractError, createAttemptRegistry, untilAbandoned } from './attempt.js';
import { oneShotStream } from './capability.js';
import type { ExpiryClock } from './clock.svelte.js';
import { sampleNow } from './clock.svelte.js';
import type { NostrContext } from './context.svelte.js';
import {
  detectEnvironment,
  MissingProviderError,
  MissingVerifierError,
  providerInputs,
  tryGetNostrContext
} from './context.svelte.js';
import type { RefreshOutcome, ReqDiagnostics, ReqState } from './engine.js';
import { deriveActivity, deriveDiagnostics, deriveState, outcomeOf } from './engine.js';
import type { CachedEventSet, RetentionOptions } from './eventset.js';
import {
  addRefusal,
  beginAttempt,
  emptyEventSet,
  endBacklog,
  endForward,
  foldEvent,
  noteFailure,
  retainNewest
} from './eventset.js';
import { canonicalKey } from './key.js';
import type { TransportCapability } from './lease.js';
import { callerTransport } from './lease.js';
import type { NormalizedDescriptor, Retention } from './normalize.js';
import { InvalidDescriptorError, normalizeDescriptor, relayMessage } from './normalize.js';
import { capture, providerDisposed, safely, terminalFailure } from './own.js';
import { ownedByLibrary } from './owned.js';
import type { ReqStateError } from './reqerror.js';
import type { ResumeHints } from './resume.svelte.js';
import type { RelayScope } from './scope.svelte.js';
import { resolveTargets, scopeGenerationOf } from './scope.svelte.js';
import type { Chunk, RequestPlan } from './stream.js';
import { planRequest, requestTargets, twoStageStream, wireFilters } from './stream.js';

/**
 * Whether a signal is **actually** aborted, and what its reason **actually**
 * is — read through `AbortSignal.prototype` rather than off the object.
 *
 * The signal in question is query-core's, and query-core hands the very same
 * object to the accumulator as `context.signal`. So every answer the engine
 * takes off it is an answer the far side of A11's seam can arrange, and two
 * arrangements were measured against the tree that read it directly:
 *
 *  - **A forged event.** `AbortSignal` is an `EventTarget`, so
 *    `context.signal.dispatchEvent(new Event('abort'))` runs every `abort`
 *    listener while `aborted` stays false. That fired the link's `cancelled()`,
 *    which aborted the *invocation's* controller for real — and the return
 *    boundary reads that controller, so a stampless return was answered as a
 *    teardown instead of as an {@link AccumulatorContractError}. Measured
 *    through a request, against `AC10`'s accumulator plus that one statement:
 *    `raw: success`, `streaming([])`, the `loading` slot, `activity: idle`, no
 *    error anywhere, and `refresh()` rejecting with an `AbortError`. The
 *    stopped-request spinner, and the fifth time that boundary has produced it.
 *  - **A shadowed property.** `aborted` is an accessor on the prototype, so an
 *    own property defined on the instance shadows it —
 *    `Object.defineProperty(context.signal, 'aborted', { get: () => false })`.
 *    That one is not reachable at HEAD, and it is exactly what a `cancelled()`
 *    that gated on `cancellation.aborted` would open: measured, a real teardown
 *    then reached nothing, `refresh()` stayed `{kind: 'pending'}` and the relay
 *    was sent **no CLOSE at all** where the unshadowed run sent two. That is
 *    #61 regenerated, which is why the obvious repair is not the one here.
 *
 * A getter taken off the prototype answers from the internal slot, so an own
 * property does not shadow it and a hostile getter does not run — `reason` is
 * read the same way for the same reason, since a throwing `reason` getter would
 * make `cancelled()` throw *inside a listener*, where the exception is reported
 * and swallowed and the invocation is left un-aborted. **Captured at module
 * load**, which is strictly before any accumulator can run.
 *
 * **What this does not defend against, and would disprove the claim**: patching
 * `AbortSignal.prototype` itself before this module is imported. That is
 * outside the seam rather than through it — it breaks query-core's own reads
 * the same way — and the difference is the whole of what "the far side cannot
 * manufacture this" means here.
 *
 * The fallback is the instance read, and it is reached only where the prototype
 * has no such accessor — a polyfilled `AbortSignal` that defines `aborted` as
 * an own data property per instance, where the instance read *is* the true one
 * and the shadow is indistinguishable from the fact. Recorded rather than
 * silent: on such a platform this degrades to the gate described above.
 */
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const reasonGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')?.get;

const trulyAborted = (signal: AbortSignal): boolean =>
  abortedGetter === undefined ? signal.aborted : (abortedGetter.call(signal) as boolean);

const trueReason = (signal: AbortSignal): unknown =>
  reasonGetter === undefined ? signal.reason : reasonGetter.call(signal);

/**
 * The cache value is the canonical event set, folded chunk by chunk.
 *
 * This used to be a flat array deduplicated by event id, which meant the
 * algebra proved of `foldEvent` — replacement identity, the created_at ordering
 * with its tie-break — was proved of a function the library never called. (That
 * list used to name "ephemeral events not retained" as a third member, and the
 * fold has not dropped them since the guard was removed: non-retention is the
 * descriptor boundary's, `B7a`.) B5 defines the cache value as the keyed set and
 * explicitly rejects a raw list, so the two disagreed.
 *
 * The settle marker rides along with it rather than being derived from the
 * query, because for a live query the queryFn's promise is never resolved:
 * `fetchStatus` is permanently 'fetching' and cannot tell "still receiving the
 * backlog" from "backlog complete, now tailing".
 *
 * Cardinality is not here. A single-event view and a list view are projections
 * of the same set (`selectOne` / `selectMany`), which is what lets one fetch
 * serve both.
 */
/**
 * No verifier anywhere: refuse to make the request.
 *
 * **Fail-closed, and the shape of the failure is the point.** The dependency's
 * own default was `emptyVerifier`, which throws — absent a verifier, rx-nostr
 * delivered nothing. Moving verification into this library and defaulting the
 * engine's parameter to "no gate" inverted that into fail-open: a caller who
 * forgot got a request that verified nothing, silently. The round that found a
 * verifier not reaching the engine cannot ship one path that still does not.
 *
 * Runtime rather than a required type, because the two callers are different.
 * A request made under a provider gets the verifier from the context and must
 * not have to name it; a measurement driving this hook directly has no provider
 * to read, and *that* is the case this catches. So the type stays optional and
 * absence is checked where both inputs are known.
 *
 * The message names the two ways out, because a thrown error whose reader has
 * to go and find the fix is half a defect report.
 */
function noVerifier(): never {
  throw ownedByLibrary(
    new MissingVerifierError(
      'nosvelte: this request has no signature verifier, so nothing would check the ' +
        'events it returns. Either use it inside a `NostrApp` provider, which supplies ' +
        'one, or pass `verifyEvent` explicitly. Tests that are not about verification ' +
        'can pass `acceptAnyEvent` from the relay helpers to say so out loud.'
    )
  );
}

export type Collected = CachedEventSet;

export const initialCollected: CachedEventSet = emptyEventSet;

/**
 * Fold one chunk into the set, then apply the bound.
 *
 * Idempotent and monotonic, and **order-independent without a qualifier again**
 * — which is a statement about the bound rather than about this function. When
 * retention ranked by expiry it was a function of the instant as well as of the
 * events, so this composed a clock-free fold with a clock-reading bound and the
 * result depended on where in the sequence a deadline fell. The bound no longer
 * reads a clock, so both halves are functions of the events seen and the
 * qualifier this paragraph used to carry has no subject left.
 *
 * A second derivation of somebody else's decision, so it is worth saying where
 * the authority is: `retainNewest` is the code that decides this, and 0003 is
 * the record. If the bound ever ranks by expiry again, this paragraph is wrong
 * before anything here changes.
 *
 * **The precondition this function has and does not check.** Chunks must arrive
 * in the order one producer made them: `beginAttempt` takes whatever attempt id
 * a `fresh` chunk names, so a *late* `fresh` from a superseded producer rewinds
 * the value to that older attempt — after which the newer attempt's own end is
 * dropped as belonging to somebody else, and a published refusal list comes
 * back **shorter**, which is B-η's falsifier word for word. Measured through
 * this function.
 *
 * It is unreachable through the shipped engine — `twoStageStream` emits `fresh`
 * once per generator, and the abort and `cancelled` checks stop a superseded
 * producer writing at all — so it is a precondition rather than a defect, and
 * it is written here because that is what a port needs and what the type cannot
 * say. `driver.ts`'s `rerequest()`, the harness closest to a port, already
 * violates it: it starts a second machine without cancelling the first and
 * folds both into one value.
 */
export function collect(
  acc: CachedEventSet,
  chunk: Chunk,
  options: RetentionOptions = {}
): CachedEventSet {
  // Every chunk lands in the value, including the ones that carry no events. A
  // leg ending and a relay refusing change nothing about what the consumer
  // *holds*, which is why they used to be dropped here and kept beside the
  // hook — but they decide slots, and a slot input outside the value is one two
  // consumers of the same cache entry can disagree about.
  //
  // A fresh attempt keeps the events (A2) and the *backlog record*, and drops
  // the previous attempt's forward leg. Both halves were measured. Clearing the
  // backlog here — which is what this line used to do to the whole leg table —
  // takes the primary state from `settled` back to `streaming` from the first
  // new event until the new EOSE, and the two axes exist precisely so that a
  // refresh does not move the primary state (P30). Keeping the forward record
  // would carry an end that belongs to a subscription this attempt has not
  // opened, so a request that stopped once would report itself stopped forever.
  const base = chunk.fresh === true ? beginAttempt(acc, chunk.attempt) : acc;
  // Named with the attempt that produced it, so a `refresh()` can tell its own
  // answer from the one that was already there. The end arrives worked out: the
  // per-relay table is the only thing that knows which relays answered, and this
  // used to translate a single reason into it — which is why a backward `ended`
  // was unrepresentable and a dead socket was reported as a clean finish.
  if (chunk.type === 'settled') return endBacklog(base, chunk.attempt, chunk.end);
  // Both legs are named by the attempt that produced the signal, and both drop
  // one that does not match. The forward branch took no id until the review
  // found the counterexample: a late refusal or end from a superseded attempt
  // landed on the record of the attempt that replaced it (E16).
  if (chunk.type === 'legEnded')
    // Frozen where it is built, because this literal *is* what
    // `ReqDiagnostics.legEnded` publishes: `deriveDiagnostics` republishes the
    // record's own `forward.end` on every read, so a consumer's write to it
    // reached the cache and the next read returned the poisoned value —
    // measured. The freeze is here rather than at the boundary that publishes
    // it for the reason the event's is: the value is owned once, where it is
    // made.
    return endForward(base, chunk.attempt, Object.freeze({ kind: 'ended', error: chunk.reason }));
  if (chunk.type === 'refused') return addRefusal(base, chunk.refusal, chunk.attempt);
  // **No arrival is rejected for having expired, no deadline passing evicts
  // anything, and expiry decides nothing about what is stored** (B7b). The
  // clause that used to end this sentence — that expiry chooses which candidate
  // gives up its slot when the bound overflows — described the round in which
  // the bound ranked by expiry, and it does not any more: the tag is read once
  // and applied once, at the projection.
  //
  // There is no arrival gate. One stood here for a round: an event already past
  // its deadline was refused before the fold saw it. That loses data
  // irrecoverably on a wrong client clock — the one direction 0001 says this
  // design must not fail in — and the instant it judged against only moved when
  // a timer fired, so a provider built at T0 judged an event arriving an hour
  // later against T0. The dependency's own gate stays off all the same
  // (`skipExpirationCheck: true`), because two parsers for one tag is the
  // defect that started this: `expiration: '1e3'` was a deadline of 1000 to
  // rx-nostr and no deadline to `expiresAt`, so whether an event could be seen
  // depended on when it arrived rather than on the event.
  //
  // What replaces it is the projection: an expired event is stored, hidden
  // while it is expired, and visible again if the clock is corrected. **The
  // bound takes no part in that any more.** It ranked by expiry for a round,
  // which put the clock into what is *stored* and cost the composition its
  // order-independence; ranking by recency instead leaves exactly one reader of
  // the tag, at exactly one point, which is what B7b asked for and what two
  // readings of one tag kept preventing.
  //
  // **This sentence said "by arrival" for a round, and that is the mutant
  // rather than the product**: `retention-cuts-by-arrival-order` is a ledger
  // entry, killed by `E6b`, `E6c`, `EX2c` and `P15`. The bound sorts on
  // `created_at` — arrival order is precisely what it must not read, since
  // reading it is what would cost the composition the property this paragraph
  // is claiming for it.
  //
  // So `foldEvent` takes neither the clock nor the bound (WR3), and neither
  // does `retainNewest`: both are functions of the events seen. The instant
  // still matters on this path, and it matters to the projection rather than to
  // anything here — see the sample at the reducer below, which is called for
  // its effect and not for a value this function is given.
  return retainNewest(foldEvent(base, chunk.packet), options);
}

// The public surface, the activity axis and the state mapping live in
// `engine.ts` so that a replacement can present the same thing without
// depending on this file. Re-exported because the measurements cite them here.
export type { QueryActivity, ReqHandle, ReqState } from './engine.js';
export { deriveActivity, deriveState } from './engine.js';

/**
 * The spike's option bag — **not** the public surface.
 *
 * A4b decides that the published options are an allowlist: a caller can set
 * what this library has decided to honour, and an option TanStack adds later
 * does not appear until it is added deliberately. `Omit<Options, forbidden>`
 * would close today's three holes and be open to the next one, and all three of
 * CONST-T15/T16/T17 are things upstream added or changed after the fact.
 *
 * This type is the opposite of that on purpose: it *accepts* the forbidden
 * options so the measurements can show what each one breaks (M10/M11/M12), and
 * every such field is marked spike-only.
 */
export interface UseStreamedReqOpts {
  rxNostr?: RxNostr | undefined;
  /**
   * The provider's signature gate, carried to the machine.
   *
   * From the context rather than built here: it and the client's
   * `skipVerify: true` are one decision, and a hook that made its own would be
   * the half of that pair which trusts nothing else made the other half.
   */
  verifyEvent?: ((event: Nostr.Event) => Promise<boolean>) | undefined;
  /**
   * The cache this request's entry lives in, handed over rather than reached for.
   *
   * It used to be `useQueryClient()`, and that made A15 unreachable: the
   * provider built a client and installed it nowhere, so the client every
   * request actually ran under was whatever was in the ambient context —
   * in the suite, whatever the test had set. `LIBRARY_QUERY_DEFAULTS` reached
   * no request at all, and the two witnesses for them constructed the defaults
   * themselves.
   *
   * Passed rather than put in the context by the provider, which was the other
   * candidate: a provider that set the query library's context key would take
   * over a consumer's own queries written inside `<NostrApp>`.
   *
   * **The premise this used to give for that was wrong, and wrong in the
   * direction that understates it.** It said the key is one Symbol under a peer
   * dependency, citing `OWN-2` — which imports the v6 alias and measures that
   * copy alone. The two copies this repository resolves do not agree:
   * `tanstack-svelte-query-v6@6.1.38` keys context by `Symbol('QueryClient')`,
   * and `@tanstack/svelte-query@5.90.2` by the string `'$$_queryClient'`. Under
   * a Symbol two module *copies* mint two keys — but how many copies exist is
   * decided by whether the declared ranges overlap, not by peer-ness, so an
   * ordinary dependency is hoisted to one copy and one key whenever they do.
   * Under a string the key is shared however it resolved. The decision holds
   * under every one of those, which is why it did not move; the reading behind
   * it has now been wrong twice. 0002 carries the resolved versions,
   * because a claim about a dependency's behaviour that does not say which
   * version is a claim nobody can check.
   */
  client?: QueryClient | undefined;
  filters: Nostr.Filter[];
  live?: boolean;
  /** B2's caller-supplied partition. See {@link EngineRequest.namespace}. */
  namespace?: string | undefined;
  /** Base for the explicit rxReqIds, so the 10^6 random space is never used. */
  reqIdBase: string;
  staleTime?: number | 'static';
  /**
   * Spike-only, all three. A4 forbids these alongside `staleTime: 0`, because
   * each on its own reopens the same hole: a live query remounted without a
   * refetch never re-establishes its subscription. Exists to measure that the
   * prohibition list needs all of them, not just `staleTime`.
   */
  refetchOnMount?: boolean;
  enabled?: boolean;
  initialData?: Collected;
  /**
   * Spike-only. When false the queryFn never touches `context.signal`, which is
   * what `Query.removeObserver()` checks before cancelling. Exists to measure
   * that failure mode, not because anything should ever set it.
   */
  consumeSignal?: boolean;
  /**
   * Spike-only. Makes the reducer throw when it sees this event id, which is one
   * of the few ways a stream can actually error: relay-side failures do not
   * error the stream at all (see the diagnostics measurements), so the reachable
   * paths are the bridge, the collector, the timeout implementation and filter
   * validation. Exists to measure what the state mapping does when one of them
   * fires during a background refresh.
   */
  poisonId?: string | undefined;
  /** Spike-only. See {@link twoStageStream}. */
  passiveAbort?: boolean;
  /** Where the query is running. The server never subscribes. */
  environment?: 'browser' | 'server';
  /** A-γ: finite, per query, overridable. See {@link EngineRequest}. */
  settleTimeoutMs?: number | undefined;
  /** B6: how many entries to keep, newest first, or `'unbounded'`. Required when live. */
  retain?: Retention | undefined;
  /**
   * The clock the public projection reads (NIP-40).
   *
   * Supplied rather than reached for, because the provider owns it: one per
   * provider, fixed on the server, and injectable in tests. Absent means "treat
   * nothing as expired", which is what the parity suite uses where expiry is not
   * the subject.
   */
  clock?: ExpiryClock | undefined;
  /** Where attempt ids come from. See {@link EngineRequest}. */
  attempts?: AttemptRegistry | undefined;
  /** The relay scope this request is made under. See {@link EngineRequest}. */
  scope?: RelayScope | undefined;
  /**
   * The relays *this request* is asked of, as a subset of what the provider
   * reads from. Absent means the provider's whole readable set.
   *
   * The consumer's own spelling: `resolveTargets` has the provider's transport
   * name it and resolves the name against the scope, so a relay this provider cannot read from is a typed
   * refusal before any REQ is sent rather than a request that quietly goes to
   * the others. Order and duplicates carry no meaning.
   *
   * **It is part of cache identity, and it replaces the provider's generation
   * on the relay axis rather than joining it.** A request that names its own
   * relays is not re-keyed when a relay outside that set joins or leaves the
   * provider — which is the whole reason the field exists in this shape.
   */
  relays?: readonly string[] | undefined;
  /**
   * Whether this hook is asking anything **yet**.
   *
   * **The published spelling is a union, not this field.** `useReq` takes
   * `() => ReqPlan`, which is `{ kind: 'deferred' } | { kind: 'request';
   * descriptor }`: a plan that is not asking carries no descriptor at all, so
   * "deferred with filters" is unrepresentable and there is no ordering
   * question about validating a descriptor nobody is asking with. This bag is
   * one flat object — it carries the owner seams beside the descriptor — so the
   * discriminant arrives as a field, the way `reqIdBase` does. `ReqPlan` is
   * published and `LK21` compiles the half a boolean cannot promise.
   *
   * What it means is the same either way, and it is not `enabled`: a deferred
   * plan builds **no key for the question it would have asked**, no attempt and
   * no REQ; it reports `loading` with `activity: 'idle'`; `refresh()` resolves
   * `{ kind: 'not-started', reason: 'deferred' }`. Becoming a request applies
   * the ordinary mount triggers, and going back releases the observer without
   * deleting the entry.
   *
   * **What it does occupy is one inert entry, shared by every deferred hook on
   * a client, and that is a price rather than a promise.** The query library
   * builds an entry when an observer is constructed, so "no cache entry at all"
   * is not something this layer can deliver; what it delivers is that the entry
   * a deferred hook holds is not the one its question would land in, carries no
   * data, runs no query function and is the same entry for every deferred hook.
   * `PL3` reads all four.
   */
  deferred?: boolean | undefined;
  /**
   * How chunks become the cache value. See {@link EngineRequest.accumulator} —
   * this is A11's seam, and it is the whole of what the two implementations
   * differ by.
   */
  accumulator?: StreamAccumulator | undefined;
}

/**
 * The descriptor and the cache key it lands under, resolved together.
 *
 * Together rather than one after the other, because the key *is* a function of
 * the descriptor and computing them apart is how they came to disagree: the key
 * used to be the caller's `queryKey` plus the scope id, so `namespace`, the
 * settle timeout, the retention bound and the filters themselves were outside
 * cache identity. Two hooks with one key and different filters shared an entry —
 * verbatim the defect 0003 opens with — and the sweep that says otherwise (K6)
 * attacked a function this engine never called.
 *
 * Called from both the options factory and `refresh()` rather than cached in a
 * variable between them. Normalising twice costs a filter walk; a stored key
 * costs the two paths disagreeing whenever the factory has not run since the
 * descriptor moved, which is the class of bug this whole file keeps finding.
 */
function resolveRequest(opts: {
  filters: Nostr.Filter[];
  live?: boolean | undefined;
  namespace?: string | undefined;
  environment?: 'browser' | 'server' | undefined;
  settleTimeoutMs?: number | undefined;
  retain?: Retention | undefined;
  scope?: RelayScope | undefined;
  relays?: readonly string[] | undefined;
  deferred?: boolean | undefined;
  /**
   * The fields whose getters threw when the caller's object was read.
   *
   * **A list beside the values rather than a marker inside them.** A sentinel
   * value stood in the fields themselves for two rounds, and every reader of
   * the descriptor domain then owed it a branch — it matched neither `'server'`
   * nor nullish where the side is decided, it was neither a scope nor absent
   * where the relays are resolved, and it rendered as JSON a consumer could
   * have written. Three of those became defects. This cannot leak: the only
   * reader is the refusal below.
   */
  unreadable?: readonly string[] | undefined;
  /**
   * Owner inputs a caller-owned request needs and its owner did not bring.
   *
   * **Refused here rather than thrown at construction**, which is where the
   * first version put it: a `throw` from the hook's body is an exception in the
   * render path — the shape `resolveRequest` exists to avoid — and on a server
   * it escapes the renderer instead of appearing on the page. It is the same
   * channel every other bad input uses, so a consumer reads it off
   * `state.error` like the rest.
   */
  incomplete?: readonly string[] | undefined;
  noProvider?: boolean | undefined;
}): {
  descriptor: NormalizedDescriptor | undefined;
  rejection: ReqStateError | undefined;
  key: QueryKey;
  /** See {@link UseStreamedReqOpts.deferred}. */
  deferred: boolean;
} {
  // **Before every other read, because a plan that is not asking has nothing to
  // check.** A deferred plan carries no descriptor on the published surface, so
  // nothing about a descriptor — its shape, its relays, its owner inputs — can
  // refuse a hook that is not asking yet. That is the whole reason the ruling
  // took a union over a `defer` field on the descriptor: the ordering question
  // "is a descriptor nobody is asking with validated" has no instance.
  //
  // `true` and nothing else. A `deferred` that is neither absent nor a boolean
  // is a caller mistake, and it is refused below with the other field checks
  // rather than coerced here — `undefined` is "asking", which is what leaving
  // the field out means.
  if (safely(() => opts.deferred) === true) {
    return { descriptor: undefined, rejection: undefined, key: DEFERRED_KEY, deferred: true };
  }
  if (opts.deferred !== undefined && typeof safely(() => opts.deferred) !== 'boolean') {
    const rejection = ownedByLibrary(
      new InvalidDescriptorError('deferred', 'must be a boolean, or absent')
    );
    return {
      descriptor: undefined,
      rejection,
      key: refusedKey(opts, rejection.message),
      deferred: false
    };
  }
  // **A field nobody could read is refused by name, before anything downstream
  // sees the descriptor.** Six of the seven would be refused by
  // `normalizeDescriptor` anyway — as absent, which is the wrong word for it —
  // and `scope` would not be refused at all: it is not type-checked there, so
  // an unreadable one used to go through as "no scope", a request asked of
  // nobody and keyed as if it had none.
  // **Read inside the guard, because it is a read like any other.** This line
  // stood above the `try` below, so a caller whose `unreadable` getter throws
  // got their exception out of the one function whose promise is that a refusal
  // comes back instead. Measured: `entryKeyOf({ filters: […], get unreadable() {
  // throw } })` threw. Internal field, same class of defect.
  const [firstUnreadable] = safely(() => opts.unreadable) ?? [];
  if (firstUnreadable !== undefined) {
    const rejection = ownedByLibrary(
      new InvalidDescriptorError(firstUnreadable, 'could not be read')
    );
    return {
      descriptor: undefined,
      rejection,
      key: refusedKey(opts, rejection.message),
      deferred: false
    };
  }
  // **After the unreadable list, not before it.** A getter that threw is a more
  // specific fault than an input the caller never brought, and a caller whose
  // `environment` throws is told about `environment` rather than about the
  // client they were never asked for until that throw made them the owner.
  const [firstIncomplete] = safely(() => opts.incomplete) ?? [];
  if (firstIncomplete !== undefined) {
    // **A request with no provider and no owner input of its own refuses as
    // what it is.** This named the first missing input — `client` — with a
    // remedy from the standalone seam `A16` withdrew: a v1 consumer cannot
    // spell `client`, cannot "build the hook again bringing no owner input"
    // (they brought none), and was told to fix a field the published descriptor
    // does not have. An adversarial pass read the message against `0004`. The
    // same situation as `useRelayDiagnostics` without a provider gets the same
    // code, which is the record's own rule for when two rows share one.
    // **Two mints rather than one over a ternary**, because `WR23` reads the
    // construction site: a `new` this library owns is the first argument of a
    // minter, and a conditional between them is a construction the registry
    // never claims.
    const rejection =
      opts.noProvider === true
        ? ownedByLibrary(new MissingProviderError())
        : ownedByLibrary(
            new InvalidDescriptorError(
              firstIncomplete,
              'is the caller’s to supply for a standalone request. The library detects the side and ' +
                'takes the relays this client is configured with, and a request with no clock makes ' +
                'no expiry judgement at all — but it cannot mint a query client or an attempt registry, and ' +
                'a request with no verifier or no client fails rather than defaulting. Supply it, or ' +
                'build the hook again bringing no owner input, which is what lets a provider serve ' +
                'it — dropping the inputs from an existing hook does not, because the owner is ' +
                'decided once, at construction'
            )
          );

    return {
      descriptor: undefined,
      rejection,
      key: refusedKey(opts, rejection.message),
      deferred: false
    };
  }
  // **One read per caller field, and the idiom below was two.**
  // `...(opts.x === undefined ? {} : { x: opts.x })` reads `x` twice: once to
  // decide and once to take. Measured through the exported `entryKeyOf` with
  // counting getters — `namespace` was read **three** times on the refused path
  // — and a `namespace` getter answering differently per read filed the refusal
  // under the *third* answer while the request had been checked as the first.
  // `B4-C7` says a field is read once; this is where that stopped being true.
  const live = safely(() => opts.live);
  const namespace = safely(() => opts.namespace);
  const settleTimeoutMs = safely(() => opts.settleTimeoutMs);
  const retain = safely(() => opts.retain);
  try {
    // **Before the descriptor, and inside the same `try`.** The relay axis of
    // the key and the relays the wire is asked of come out of one resolution
    // (`resolveTargets`), and a target this provider cannot read from is
    // refused here — on the channel every other descriptor refusal takes,
    // rather than as a throw in the render path.
    //
    // Read once, like every other caller field on this path: `B4-C7`.
    const effective = resolveTargets(opts.relays, opts.scope);
    const descriptor = normalizeDescriptor({
      filters: opts.filters,
      // **Forwarded, not defaulted here.** `live: opts.live ?? false` put the
      // one field on this path behind a coalesce, so `live: null` became
      // `false` while `live: 0` and `live: 'yes'` were refused — the silent
      // default the boundary exists to remove, on the boundary's own doorstep.
      // The default lives where the other defaults live.
      ...(live === undefined ? {} : { live }),
      // B3, on the path. This was the literal `'streamed'`, which made the
      // field look wired while carrying nothing about relays.
      //
      // **And it is the *effective target set's* identity now, not the
      // provider's.** With no `relays` on the request the two are the same
      // string, which is why nothing about an ordinary request changes; with
      // one, the key stops moving when the provider's list moves.
      scopeGeneration: effective.generation,
      ...(effective.requested === undefined ? {} : { relays: effective.requested }),
      // **Resolved by the caller, and it used to be resolved here.** The line
      // read `opts.environment ?? tryGetNostrContext()?.environment`, which put
      // a Svelte context read inside a module-level function reached from three
      // places with three different lifecycles — one of them legal and two of
      // them not. `getContext` may only be called during component
      // initialisation or inside a reaction created during one (`SEN29`,
      // `SEN30`), and this function is also called from `refresh()`, which for
      // the published shape runs in a click handler. The read is taken once at
      // the hook's construction now and handed down; see `captureProvider`.
      environment: opts.environment ?? 'browser',
      ...(namespace === undefined ? {} : { namespace }),
      ...(settleTimeoutMs === undefined ? {} : { settleTimeoutMs }),
      ...(retain === undefined ? {} : { retain })
    });
    // Prefixed so an entry this library owns is recognisable in a cache it may
    // one day share, and so the key is never a bare string a caller could
    // collide with by accident.
    return {
      descriptor,
      rejection: undefined,
      key: ['nosvelte', canonicalKey(descriptor)],
      deferred: false
    };
  } catch (e) {
    // **Every read on this path is guarded, not only every value.** The repair
    // before this one made the *values* on the key total — checked primitives
    // and the renderer's output — and left three reads that can throw on the
    // way to them: `String(e)` on an object with no prototype, `.message` on an
    // Error whose getter throws, and `scope.id` on a scope whose getter is what
    // was being refused. A throw here leaves `resolveRequest` altogether, into
    // the options factory, which is the same shape as the defect this path was
    // repaired for: an exception in the render path instead of a refusal on
    // `state.error`.
    // **`instanceof` is a read as well**, and it was the fourth one here: it
    // invokes `getPrototypeOf`, which a `Proxy` can make throw — so a caller
    // whose getter throws such a proxy got its exception out of this handler
    // before the guard on the next line ever ran.
    const thrown = capture(e, 'descriptor');
    // The freeze happens inside {@link ownError} now, with the identity test and
    // the rendering, because those three are one boundary and were written at
    // four sites — this one held all three, `noteFailure` held none, and a
    // reviewer measured the difference as a `TypeError` where a failure should
    // have been.
    const rejection = terminalFailure(thrown);
    // A refused descriptor has no canonical form — that is what refusing it
    // means — and it still needs an entry to carry the failure. Keyed by the
    // message, so two refusals that share one are refusals with the same text:
    // the entry holds an error and nothing else, so the only thing a merge here
    // could hand one caller is the other's identical message. Keying it by the
    // caller's raw input instead would put `NaN` and `null` on one key again,
    // which is the collision `normalizeDescriptor` exists to remove.
    //
    // **That last sentence was false for a round and is true now**, which is
    // worth saying because it is the reason rather than the conclusion: the
    // message rendered `NaN`, both infinities and `null` identically —
    // `JSON.stringify` answers `null` for all four — so keying by it merged
    // exactly what keying by the raw input would have. `describeValue` names
    // them apart now (`NZ14`).
    //
    // **What does share a key here, by construction**: two large values whose
    // renderings agree up to the bound, since the message is cut (`NZ15`); and
    // any two callers who choose the same text through a `toJSON`. Both land on
    // the argument above rather than around it — an entry that holds one error
    // and no data can only hand back that error.
    // **The namespace is on this key too, because the published type says so.**
    // `ReqDescriptor.namespace` is documented as "partitions the cache; it can
    // only split, never merge", and that was a universal with an exception
    // nobody had written down: two consumers in different namespaces, asking
    // different questions, refused for the same field landed on one entry.
    // Measured. Nothing bad reached either of them — the entry holds an error
    // and no data, which is the argument above — but a published sentence that
    // is false in a corner is a sentence a port cannot use, and splitting costs
    // an entry nobody keeps.
    //
    // The scope's identity joins it for a different reason, and not the one
    // written here first — it does **not** separate two providers, because
    // `scopeGenerationOf` is the readable relay set's identity and two
    // providers configured alike share it. It does not have to: each provider
    // owns its own client (C6), so no entry crosses them. What it separates is
    // the same descriptor under two *relay sets*, which is what the accepted
    // key already does — a refusal is a fact about a request, and a request's
    // relays are part of what it is.
    return {
      descriptor: undefined,
      rejection,
      // **The guard came back, and the reason it was removed was wrong.** It was
      // taken off on the premise that `rejection` "is either one of our classes
      // or a `ReqFailure`", because the failure channel publishes a value this
      // library made — and that premise was about the *class*, not about the
      // *object*. The published classes have public constructors, so a consumer
      // could build one, redefine `message` as a throwing accessor (the
      // constructor's own data property is configurable) and throw it at a
      // filter getter: measured, the read threw out of the hook into the
      // consumer's render and **no `state.error` was published at all** — the
      // failure was lost, on the one path whose promise is that it is not. A
      // second shape put their circular object on the query key, which is the
      // defect `refusedKey`'s own docblock exists to prevent.
      //
      // The registry answers "did this library construct it" now rather than
      // "is it one of our classes", so that door is shut. This read is guarded
      // anyway: **a failure path is a second trust boundary**, and the cost of
      // being wrong here is the whole channel going silent.
      key: refusedKey(opts, relayMessage(safely(() => rejection.message)).text),
      deferred: false
    };
  }
}

/**
 * Read a caller's field and say whether the read itself failed.
 *
 * **Two answers `safely` collapses into one.** `safely` returns `undefined` for
 * a read that threw and for a value that is legitimately absent, which is the
 * right shape almost everywhere in this file — a field that is missing and a
 * field that cannot be read are both "not usable". On `refresh()` they are not
 * the same: a server provider has no `rxNostr` by construction, and refusing
 * that is refusing a call that should resolve.
 */
function readSeam<T>(read: () => T): { read: true; value: T } | { read: false } {
  try {
    return { read: true, value: read() };
  } catch {
    return { read: false };
  }
}

/**
 * The entry a refused descriptor is filed under.
 *
 * **One builder for both refusal paths, and it is one because they diverged.**
 * The unreadable-field branch was written as a copy of this and left the scope
 * identity unguarded — which is character-for-character the mutant an entry in
 * the ledger is aimed at, reintroduced in the commit that was simplifying this
 * very machinery. Two copies of a key is two chances to be wrong about it.
 *
 * **The namespace before the generation, because prefixes are how a consumer
 * selects**: `removeQueries({ queryKey: ['nosvelte', 'refused', mine] })` is
 * the operation this ordering exists for. With the generation first, the only
 * thing a consumer could name is the scope's identity — a string built from
 * their own relay URLs, whose spelling is the transport's (`TD1`) and whose
 * order this library does not contract.
 *
 * **And both are the *checked* values, not the caller's.** This is the path
 * taken because the boundary refused something, so the inputs are the ones
 * known to be untrusted — and one of the things a descriptor is refused *for*
 * is a `namespace` that is not a string. A circular object left on this key
 * does not fail like a refusal: query-core hashes a key with `JSON.stringify`,
 * so the `TypeError` came out of *option construction*, in front of the
 * `InvalidDescriptorError` that was supposed to reach `state.error`.
 */
/**
 * Where a hook that is not asking anything sits.
 *
 * **One key for every deferred hook on a client, and that is deliberate.** The
 * entry a deferred plan holds must not be the entry its question would land in
 * — otherwise a hook that has not asked yet would occupy, and could read, the
 * cache value of the request it is about to make — so it cannot be derived from
 * the descriptor. It is not derived from anything: two deferred hooks are the
 * same "no question", they hold nothing, and one shared inert entry is the
 * smallest thing the query library will let an observer be built on.
 *
 * Under this library's own prefix so it is recognisable in a cache it may share,
 * and so `removeQueries({ queryKey: ['nosvelte'] })` still reaches it.
 */
const DEFERRED_KEY: QueryKey = ['nosvelte', 'deferred'];

/**
 * How long a recovery waits, per consecutive attempt, in seconds.
 *
 * **Written out rather than computed**, because what a port owes is the shape
 * and not a formula: it starts inside a human's patience, it stops doubling, and
 * the ceiling is the interval a feed nobody is watching costs. The last entry
 * repeats for every attempt past the list.
 */
const RECOVERY_BACKOFF_SECONDS = [2, 5, 15, 60, 300] as const;

const refusedKey = (
  opts: { namespace?: string | undefined; scope?: RelayScope | undefined },
  message: string
): QueryKey => [
  'nosvelte',
  'refused',
  keyPartOf(() => opts.namespace),
  keyPartOf(() => scopeGenerationOf(opts.scope)),
  message
];

/**
 * A key element out of a read that may throw.
 *
 * **A getter that throws is not an absent value, and folding the two together
 * is this key's own defect one step in.** `safely` answers `undefined` for both,
 * so an unreadable `namespace` keyed exactly where *no* namespace keys — the
 * partition `keyPart` builds `false` for, entered by the one input that cannot
 * even be looked at. Reached through {@link entryKeyOf}, which takes the
 * caller's object directly — **not published**: `surface.ts` lists it as
 * internal-only and `EK9`'s own arm asserts that, so the reachability argument
 * here is about this library's callers rather than about a consumer's. Through
 * the hook the field is refused by name one frame up, which is why the merge sat
 * here unseen (`EK9`).
 */
const keyPartOf = (read: () => unknown): string | null | false => {
  try {
    return keyPart(read());
  } catch {
    return false;
  }
};

/**
 * A value a cache key may carry, out of one that may be anything.
 *
 * **The rule the failure path needs, in one place.** A key is hashed with
 * `JSON.stringify` by the query library, so every element has to be something
 * that survives it — and the elements available on the refused path are the
 * caller's own inputs, which is what the boundary has just finished objecting
 * to. Absent stays absent (`null`); a string is itself; **anything else becomes
 * `false`**, which no namespace and no scope identity can be, so an unusable
 * value collides with nothing a working request could produce.
 *
 * `false` rather than a sentinel string for exactly that reason: a string
 * marker is a namespace somebody may legitimately choose, and merging their
 * refusals with the unusable ones would be this key's original defect wearing a
 * different value.
 */
const keyPart = (value: unknown): string | null | false => {
  if (value === undefined) return null;
  return typeof value === 'string' ? value : false;
};

/**
 * **Which reads of the caller's object are guarded, and which are not.**
 *
 * Four rounds of review found the same defect four times — another read left
 * raw — because each repair was written per site. The rule, once, so that the
 * next site is decided rather than discovered:
 *
 * - **Descriptor fields** (`filters`, `live`, `namespace`, `environment`,
 *   `settleTimeoutMs`, `retain`, `scope`) are read through `read()` in
 *   {@link requestOf}, which records the *name* of a field whose getter threw
 *   and leaves the value absent. `resolveRequest` refuses the first such name:
 *   the consumer is told which field, on `state.error`. The name travels beside
 *   the values and never inside them — a sentinel value stood in the fields for
 *   two rounds and each reader of the domain owed it a branch, three of which
 *   were missing and became defects.
 * - **Seams read where nothing can be refused** — `clock` at its three sites
 *   (the expiry effect, the fold, and `projected`, which `state` and
 *   `diagnostics` are both built from); `live` in `activity` — are read through
 *   {@link safely}. A getter has no error channel, so an unreadable `clock`
 *   costs a projection its expiry and an unreadable `live` answers "not live".
 *   Those two are the coercions on this surface, and the descriptor half of
 *   `live` still refuses by name.
 * - **Everything else is read raw**: the required seams (`client`, `rxNostr`,
 *   `attempts`, `verifyEvent`, `accumulator`) and the spike-only
 *   pass-throughs (`reqIdBase`, `staleTime`, `refetchOnMount`, `enabled`,
 *   `initialData`, `consumeSignal`, `poisonId`, `passiveAbort`). A getter that
 *   throws there is a wiring bug with nowhere to be reported — the client *is*
 *   the channel a refusal is published on — so the throw is the consumer's own.
 *   **A port that can carry such a report owes a decision here that this spike
 *   does not have.**
 * - **The thunk itself is not guarded.** `useStreamedReq(() => ({ … }))` is the
 *   caller's function; if its body throws, that is their exception in their own
 *   frame, and this library never sees an options object to refuse anything
 *   about.
 * - **One read that is none of the above**, and it is named rather than left to
 *   be found: the construction-time test that decides whether to capture a
 *   provider reads `environment` and `verifyEvent` through {@link safely} and
 *   coerces a throw to "capture one". It runs before any refusal has a place to
 *   go — there is no query, no cache entry and no `state` yet — so the only
 *   answers available are "capture" and "throw", and capturing is the one that
 *   leaves the request refusable.
 *
 * {@link safely} is the mechanism for the second; `read()` in {@link requestOf}
 * is the first, and it is deliberately not `safely` — absent and unreadable
 * have to stay apart, and only `read()` keeps them so.
 *
 * A read that may be the caller's, taken where a throw would escape.
 *
 * `undefined` for "it threw", which every caller here turns into the same thing
 * an unusable value becomes. Deliberately not a `catch` that reports: this runs
 * inside the handler for a refusal that is already on its way to the consumer,
 * and a second error there would replace the first.
 */
// **Imported rather than declared, which it was not for two rounds.** This file
// carried a byte-identical copy of `own.ts`'s guard while `own.ts`'s docblock
// said the function is "used here and in `useStreamedReq.svelte.ts`" — one
// sentence about two functions, so an edit to the shared one reached none of the
// reads below and `WR22`'s rule (a value has one declaration) was broken on the
// library's own hostile-value guard.

/**
 * Where a request's value is kept, derived and not supplied.
 *
 * B1/B2 in one line: everything that changes what the request means, or where
 * its results may have come from, is an input — the filters, `live`, the settle
 * timeout, the retention bound, the relay scope (B3) and `namespace`, which is
 * the one thing the caller says and can only ever split with. There is no
 * caller-supplied key, so "two different requests share an entry" is not a shape
 * a caller can write; the `queryKey` this engine used to take is removed from
 * the published surface by 0004 C3 for the same reason.
 *
 * Exported because a test that drives the shared entry from outside the hook —
 * refetching it, reading it, removing it — has to name it, and the alternative
 * is each such test rebuilding this derivation and drifting from it.
 *
 * **Residue: this lost a context read, and the loss is recorded rather than
 * silent.** While `resolveRequest` resolved the environment itself, an absent
 * `opts.environment` fell back to the provider's; it now falls back to
 * `'browser'` and the provider is consulted only by the hook. Two things are
 * true about what that costs and both are worth writing down, because only the
 * first makes it harmless:
 *
 *  - **It was unreachable.** Every caller is a test, and every one of them
 *    calls this at test-body level — outside any component — where the read it
 *    used to make throws rather than answering. So nothing was getting a
 *    provider's environment through this function; the suite only appeared to
 *    because `src/tests/setup.ts` replaces `getContext` with a `Map`.
 *  - **And it changes nothing this function returns, which is a stronger
 *    statement than the one that stood here.** That one said a call from inside
 *    a component under a server provider used to key as `'server'` and now keys
 *    as `'browser'`. It cannot: `canonicalKey` deliberately does not take
 *    `environment` — `key.ts` argues at length for keeping it out, because a
 *    cache owner has one environment and keying on it would split its entries on
 *    a fact that cannot vary inside it — and
 *    this function returns the key alone. The environment reaches `planRequest`,
 *    which decides whether a REQ is sent, and that decision is not this
 *    function's to report. So the lift is invisible here in both directions,
 *    and the parameter is what a caller that ever needs the distinction uses.
 */
export function entryKeyOf(opts: Parameters<typeof resolveRequest>[0]): QueryKey {
  return resolveRequest(opts).key;
}

/**
 * Did this attempt *end*, on the value it left behind?
 *
 * The same comparison {@link backlogOutcome} makes, asked from the writing side
 * instead of the waiting one, and asked about the same two slots. An attempt
 * ends by reaching a backlog end or by failing; `endBacklog` writes the first
 * under the ending attempt's id and `noteFailure` writes the second under the
 * throwing attempt's, and nothing else on this value is an ending.
 *
 * **Two slots, and it used to be four.** `running` and `forward` were in here,
 * on the reading that an attempt named anywhere on the value had "reached" it —
 * and reaching the value is not ending. `beginAttempt` stamps both legs on the
 * *first* chunk of an attempt, so a single chunk of any kind puts this attempt's
 * id on `running` and `forward` while the request behind it is still open. That
 * made the return boundary accept the accumulator r15's review exhibits:
 *
 * ```ts
 * for await (const chunk of streamFn(context)) { value = reducer(value, chunk); break; }
 * return value;
 * ```
 *
 * With a backward refusal as its first chunk, the standard reducer stamps
 * `running` and `forward` with this attempt, `break` closes the stream and the
 * wire, no backlog end and no failure is ever written — and the four-slot
 * predicate answered *true*, so the query succeeded over a value carrying no
 * outcome at all. The consumer saw `streaming([])` with `activity: idle` behind
 * the `loading` slot while `refresh()` rejected with an abandonment
 * `AbortError`: the stopped-request spinner, regenerated through the seam for
 * the fourth time. **The stamp says a chunk arrived. It does not say the attempt
 * ended**, and the boundary needs the second.
 *
 * What this is asked alongside at the return is whether anything tore the
 * invocation down. **Not whether its stream unwound**, which stood here for a
 * round: a stream that simply finished unwinds too, so an accumulator that folds
 * with something of its own and hands back a value the chunks never reached was
 * read as a teardown and sent to the abort side.
 *
 * **What it is a fact about is the value, and that bound is the honest one.**
 * The value is the accumulator's to construct, so this can say "an end for this
 * attempt is recorded here" and can never say "the request behind it is over".
 * The two come apart for a live invocation that folds the backlog completion and
 * returns with the forward leg still open — an end *is* recorded, truthfully,
 * and the request is not finished. That case is out of this predicate's reach
 * and out of the boundary's; what forbids it is a postcondition of the two
 * accumulators this library ships — `A11-P2` in 0002, which holds an invocation
 * open until the iterator it is draining has exhausted itself, over a stream
 * `A11-P1` obliges it to have been taking all along. **When that iterator is
 * entitled to finish is A5's answer and not A11's**: for a live request it is
 * the backlog's outcome *and* the forward leg's end, in whichever order the two
 * arrive. So a return at the backlog end is early because a leg is still open,
 * not because the forward one is the leg that counts — the forward leg is not
 * always the last, which is the whole of `P32`. That is what "A11 is not
 * correct by construction for any type-conforming function" means.
 *
 * **Out of reach here is not out of reach everywhere, and the witness is on the
 * other axis.** Whether an invocation returned is unreadable from the value —
 * which is this whole paragraph — and readable from the handle, because
 * `activity` is derived from query-core's `isFetching`. Measured both ways: an
 * accumulator that returns at the live backlog end shows `idle` while the
 * request is still live (`P25`), and one that hangs after draining its stream
 * shows work outstanding over an answer that is complete in every field (`P32`,
 * `P45`). Derive that axis from the value's own legs instead and both go quiet.
 *
 * See the boundary in the query function, where the two questions are read
 * together, and `A11-C13`/`A11-C15` for the predicate.
 */
function leftATerminalOutcome(data: Collected | undefined, attemptId: AttemptId): boolean {
  if (data === undefined) return false;
  return data.backlog?.attemptId === attemptId || data.failure?.attemptId === attemptId;
}

/**
 * Options are read through an accessor, the way v6 expects, so that a changing
 * key or filter set re-evaluates rather than being frozen at first call.
 */
/**
 * Wait for this attempt's backlog to reach an end, and say what it was.
 *
 * Watching the cache rather than the call, because the call cannot answer: for
 * a live request the query function's promise never settles, and for a reset
 * one it resolves when the re-run *starts*. What ends either way is the
 * backward leg, and it is on the value.
 *
 * `mine` is what makes it *this* attempt's end. Reading the leg table alone
 * resolved on whatever was already recorded, so a refresh over a settled
 * request answered before its own REQ had been replied to — with the previous
 * answer. The stamp on the value is the fix and this is the half that reads it.
 *
 * Both outcomes are matched that way. A failure used to be attributed by time
 * order instead, which is what r11 objected to; it carries the attempt's id on
 * the value now, so the two halves of `read()` are one comparison twice.
 *
 * Equality, not "newer than what was there". The ordering form could not say
 * "mine" even in principle: two calls on one key read the same `before`, so
 * either could be answered by the other's outcome. The id is claimed before the
 * attempt is triggered, so the only value that satisfies this is the one the
 * attempt this call asked for produced.
 *
 * What ends the wait when no outcome comes is `lifetime`, and there is no timer
 * behind it. The premise that used to be written here — "a running attempt
 * always reaches an end, because A-γ's timer belongs to the request" — is true
 * of an attempt that built a machine and of no other kind, and r13 found the
 * other kind: A-γ's timer lives inside `referenceStream`, so an accumulator that
 * resolves without calling its `streamFn` produces no machine, no REQ and no
 * timer, and nothing was ever going to write an end for it. The sentence was
 * standing on a step the seam is not required to take.
 *
 * What is true is narrower and is made true rather than assumed: every
 * invocation of the query function ends the attempt it claimed at its entry, one
 * way or another, before it leaves. It produces an outcome under that id; or it
 * is torn down, which unwinds its stream and abandons it; or its return finds
 * neither, and *fails* it with an {@link AccumulatorContractError} — which is an
 * outcome too, and is why this wait no longer needs the return to abandon
 * anything for the case the seam walked away from. So the ways a wait ends are
 * an outcome on the value, the invocation being torn down, a later claim on the
 * same lane, a trigger that opened nothing, and a query function that returned
 * having left no ending behind.
 *
 * **"Before it leaves" is where that sentence stops being true, and the gap is
 * closed from the other end rather than here.** An invocation that never leaves
 * has no return to be bounded at, and r13's accumulator has a sibling that
 * simply never resolves. What ends the attempt then is
 * {@link linkCancellation}: query-core's cancellation is joined to the
 * invocation at the query function's *entry*, so a consumer that goes away
 * abandons the attempt whether or not the seam ever opened a stream. A pending
 * invocation whose consumer stays is bounded by nothing — whether it never
 * opened the stream or opened it and stopped taking what it yields — and 0002
 * records that as a limit rather than as something this wait can rescue. What
 * obliges the two shipping accumulators not to be either of those is `A11-P1`,
 * which is a postcondition of those two functions and not of the seam's type.
 *
 * The cache entry being removed is on the reviewer's list of those ways and is
 * deliberately not a case here: removing an entry cancels the fetch under it,
 * which unwinds the stream, which is already the first of them. A version of
 * this function that watched for the entry disappearing was written first, and
 * deleting that watch killed nothing. Two mechanisms for one claim is how two
 * readers come to disagree.
 *
 * **"M22 still passes" was the evidence offered for that, and it is weak
 * evidence**: at the time, that arm removed only its own entry, so the two
 * mechanisms answered identically by construction and nothing could have told
 * them apart. `M22` removes a neighbour's entry first now, which separates
 * "watches its own key" from "watches the cache" — and the same probe found
 * that a non-live `refresh()` never reaches this subscription at all before its
 * fetch is cancelled, so the deleted watch was unreachable rather than
 * redundant.
 */
/**
 * Which lifecycle end an abort reason is, if it is one.
 *
 * Read off the value's own `code`, which is the discriminant this library gives
 * every failure it owns — rather than off the message, which is prose, or off
 * the call site, which the waiter cannot see.
 *
 * **The two codes it recognises are the two whose only meaning is "the lifetime
 * ended"**, and that is why they belong on the value channel: neither names
 * anything a consumer can do. Anything else — including a value that is not one
 * of this library's at all — comes back `undefined` and rejects, because a
 * boundary that answered "cancelled" for an unknown reason would swallow the
 * one case a consumer has to see.
 */
function cancellationOf(reason: unknown): RefreshOutcome | undefined {
  const code = safely(() => (reason as { code?: unknown } | undefined)?.code);
  if (code === 'attempt-abandoned') {
    return Object.freeze({ kind: 'cancelled', reason: 'consumer-released' } as const);
  }
  if (code === 'provider-disposed') {
    return Object.freeze({ kind: 'cancelled', reason: 'provider-disposed' } as const);
  }
  return undefined;
}

async function backlogOutcome(
  client: QueryClient,
  key: QueryKey,
  mine: AttemptId,
  lifetime: AbortSignal
): Promise<RefreshOutcome> {
  const cache = client.getQueryCache();
  return await new Promise<RefreshOutcome>((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    const stop = (): void => {
      unsubscribe();
      lifetime.removeEventListener('abort', abandoned);
    };
    const read = (): boolean => {
      const entry = cache.find<CachedEventSet>({ queryKey: key, exact: true });
      if (entry === undefined) return false;
      const data = entry.state.data;
      // Both halves are the same comparison now, and that is the repair. A
      // failure carries the id of the attempt that threw, so it is attributed
      // the way an answer is — by equality with the id this call claimed before
      // anything started — rather than by the time order this line used to
      // reason from ("the previous error was cleared when this attempt started,
      // so the error I can see is mine"). That premise held only for an entry
      // with no value at all (SEN22), and a recorded failure *is* a value.
      //
      // **The end is checked first, and nothing can tell that apart from the
      // other order.** This said the opposite for a round — that the order
      // decided a reachable case — and the ledger contradicted it: the entry
      // aimed at exactly this ternary,
      // `failure-reported-over-an-answer-that-arrived`, was applied across
      // `parity-refresh.test.ts` and `errormap.test.ts` and killed nothing.
      //
      // What is true is that the *value* reaches the pair the claim named. A
      // live attempt whose backlog completed and whose forward leg then threw
      // carries an end and a failure under one id — measured through a request,
      // and `E17b` is where the fold's answer to that pair is pinned. What is
      // false is that this read ever sees it. Two facts close it, either alone
      // enough. `endBacklog` drops a failure that is not the ending attempt's,
      // so at the write that makes `ended` true there is no *foreign* failure
      // left to report. And this runs synchronously on every cache write —
      // query-core calls its cache subscribers inside `notifyManager.batch`
      // rather than scheduling them — so the end and the failure are never read
      // together: the promise resolved on the end one write before the forward
      // leg's failure was recorded. The remaining order, a same-attempt failure
      // written *before* its own end, resolves here as `error` either way, and
      // it is what `E17b` records as unreachable through the engine.
      //
      // So the ternary is defensive rather than a behaviour choice. Kept
      // because it lets this function answer the question it is named for
      // without borrowing `endBacklog`'s clearing rule or the dependency's
      // notification timing — a failure over data already delivered belongs on
      // the diagnostics axis (C5), and that is stated here rather than relied
      // on from two other places. The ledger entry carries the empty kill set
      // and says the same thing, so the record no longer claims a difference
      // nothing can observe.
      const ended = data?.backlog?.attemptId === mine;
      const failed = data?.failure?.attemptId === mine;
      if (!ended && !failed) return false;
      const outcome = outcomeOf(data, ended ? undefined : data?.failure?.error);
      if (outcome === undefined) return false;
      stop();
      resolve(outcome);
      return true;
    };
    const abandoned = (): void => {
      // One turn before believing it, and not as a grace period: an attempt
      // that ends by *throwing* becomes this query's error a few microtasks
      // after its stream has unwound, so a read taken at the unwind sees
      // neither the value nor the error and would report an abort for an
      // attempt that failed — which C11 says is an outcome, not a rejection.
      // A macrotask runs after every microtask already queued, which is
      // exactly the ordering that claim needs and no more.
      // **A lifecycle end is an outcome, not a rejection.** This rejected with
      // whatever the abort carried, which made
      // `onclick={() => handle.refresh()}` — the line every application writes
      // for a retry button — produce an **unhandled promise rejection** when a
      // consumer navigated away from a slow feed. Nothing went wrong there, and
      // the value it rejected with was deliberately untypeable:
      // `catch (value: unknown)`, six codes, no exported alias.
      //
      // What moves is the lifetime ending. Everything else still rejects — a
      // caller's own exception is not promised never to — and a failure the
      // attempt *answered* is read by `read()` as `error` rather than reaching
      // the classification at all.
      setTimeout(() => {
        if (read()) return;
        stop();
        const cancelled = cancellationOf(lifetime.reason);
        if (cancelled !== undefined) resolve(cancelled);
        else reject(lifetime.reason);
      }, 0);
    };
    if (read()) return;
    if (lifetime.aborted) {
      abandoned();
      return;
    }
    lifetime.addEventListener('abort', abandoned, { once: true });
    unsubscribe = cache.subscribe(() => {
      read();
    });
  });
}

/**
 * The provider this request is being constructed under, when it needs one.
 *
 * **Nothing here catches, and the `try` that stood here is the defect it was
 * closing, moved one level up.** It caught the framework's outside-a-component
 * error and answered `undefined`, justified by an enumeration of the ways to
 * reach this point: a component under a provider, where the read is legal and
 * finds one; and a measurement driving the engine directly — from
 * `$effect.root`, or from a test body — which has no component *and* no
 * provider and supplies these values itself. Both want `undefined`, and the
 * enumeration was wrong.
 *
 * **The third way is a component under a real provider that builds its request
 * lazily**, from a click handler inside an effect root, which is neither
 * component initialisation nor a reaction. The read throws there, the catch
 * swallowed it, and what the consumer got was measured rather than argued
 * (`LC5`, `LC6`, `LC7`):
 *
 *  - with nothing supplied, `{kind: 'error'}` carrying "this request has no
 *    signature verifier … Either use it inside a `NostrApp` provider" — from
 *    inside one, on the channel a dead relay arrives on;
 *  - with the caller's own verifier supplied, the provider's `environment`
 *    dropped — nothing says so, and what the consumer is told is about
 *    something else entirely. Under a *server* provider the request took
 *    `'browser'`, reached the disposal check with the transport such a provider
 *    deliberately has none of, and rejected with "the provider connection is
 *    terminated … no later attempt will succeed" — which is `AE22`'s defect
 *    regenerated, and false of a page about to hydrate.
 *
 * That second one is verbatim what the old docblock said the catch must never
 * produce. A catch here cannot distinguish "wrong window" from "no provider",
 * which is exactly the merge {@link tryGetNostrContext} refuses to make inside
 * itself — made instead at the one site an enumeration declared safe.
 *
 * **So the read is skipped rather than guarded.** `needed` is false whenever
 * the caller has brought **any** owner input — the boundary is seven fields
 * and one of them moves the owner, which this sentence still described as two
 * until a reviewer swept for the phrase — and a request that consults no
 * provider does not care whether one could be read: driving the engine directly from anywhere keeps working (`LC3`),
 * because it is not the *window* that is being tolerated, it is that nothing is
 * being asked. Where the provider is needed and the window is wrong, the
 * framework's own diagnosis reaches whoever wrote the call — which is the true
 * one: a hook must be created during initialisation.
 *
 * **What that costs, said plainly, because it is the same trade in the other
 * direction.** A caller with no provider *at all*, in an illegal window, with a
 * verifier they never passed, is now refused for the window and told nothing
 * about the verifier — the window is named and the missing provider is not.
 * That is the reverse of the merge this removes, and it is accepted for one
 * reason: the answer it gives is *true* of what happened, where the caught
 * version's was false — it said "use it inside a `NostrApp` provider" to a
 * caller who was inside one. A true partial diagnosis and a confident wrong one
 * are not the same defect. It is also why `LC4` had to move into a legal
 * window to keep saying what it says: with no provider and no legal window, the
 * two causes are both present and an arm cannot tell which was answered.
 *
 * **This is called once and its result is held**, which is the repair the
 * capture was introduced for. `getContext` is legal during component
 * initialisation and inside a reaction created during one, and throws
 * everywhere else — measured at svelte 5.56.8 by `SEN29` and `SEN30`, in both
 * export conditions. The three reads it replaced were taken at three
 * lifecycles: the options factory's, which is a `$derived` and legal;
 * `refresh()`'s, which for the published shape is a click handler; and the
 * stream function's, which is legal on a mount and illegal on a re-fetch driven
 * from outside a reaction.
 *
 * **The context *object* is held, not fields off it, and that is what keeps the
 * capture from costing liveness.** `scope`, `client` and `configurationError`
 * are getters over `$state` on this object, so reading them through the held
 * reference is exactly as live as reading them through a fresh `getContext`
 * would be; `environment` and `verifyEvent` are written once in
 * `createNostrContext` and never reassigned, and a provider renders on one side
 * for its whole life. Nothing on this object is a snapshot.
 *
 * **The window this decides in, and what falls out of it.** Whether a provider
 * is consulted is decided from the options as they read at construction, and
 * they are an accessor — so a caller who brings an owner input and later stops
 * bringing it stays the owner. `A16` says that in the record and `OM3` is the
 * arm: an owner input that *appears* after construction does not move the owner
 * either, in the same direction and for the same reason.
 *
 * **What that costs is bounded by the rule above it.** A caller who owns the
 * runtime resolves the three inputs that can be resolved without them — the
 * side is **detected** rather than defaulted, the relays are the ones their own
 * client carries, and an absent clock is **no expiry judgement at all** rather
 * than a real one — and never takes the provider's, which is what `OM2`
 * measures by counting what the provider is asked for.
 *
 * **Four inputs have no resolution, on two channels, and this sentence used to
 * say two.** The cache and the attempt registry are refused by name on the
 * outcome channel (`InvalidDescriptorError`, the `field` naming which). The
 * **verifier** is the third and it is refused differently: `noVerifier()`
 * throws where the query function is built, so the request ends `error` with a
 * `ReqFailure` carrying "this request has no signature verifier" — measured, on
 * a complete bundle with `verifyEvent` removed. The **transport** is the fourth
 * and it ends the same way: with nothing to ask, `requestTargets` refuses by
 * the name of the seam, and its message used to say the client "has been
 * disposed" about a client that was never supplied. An adversarial reviewer read
 * the older sentence ("a verifier that refuses everything") against `0004`,
 * which had already decided that no fail-open default would ship. So the late-field case is a caller reading their own defaults
 * rather than a request wearing two owners' values, which is the defect this
 * decision exists for.
 *
 * **The published surface cannot reach any of it.** `0004`'s `ReqDescriptor` is
 * six fields and declares none of the seven, so every consumer is in the
 * provider-owned branch; a caller driving this seam directly is the only one
 * who can be in the other. The paragraph this replaces described the two-field
 * boundary — "a caller who supplies both" — and named `rxNostr` as a required
 * option, neither of which has been true since the bundle closed over all
 * seven.
 *
 * **And skipping the read is not what keeps the direct-engine measurements
 * working, which the first version of this said.** Counted: of the call sites
 * in this suite, only a handful bring an owner input at all, and the rest —
 * over a hundred —
 * ask for the provider and sit inside an effect root, where the read is
 * illegal. They pass because the harness replaces the framework's context with
 * a map, which is the thing one file opts out of in order to see this class at
 * all. So the skip buys the handful, and the mock buys the rest; saying the
 * first covers "most of that directory" was the size of the mock rather than
 * the size of the design.
 */
function captureProvider(needed: boolean): NostrContext | undefined {
  return needed ? tryGetNostrContext() : undefined;
}

/**
 * Which side of the ownership line a request stands on, as one value.
 *
 * **Two arms and no third.** The transport and the relay scope used to be
 * resolved one field at a time, which made a provider's transport and a
 * caller's scope constructible together — and an outside reviewer measured what
 * that costs: the provider's client opened a connection to a relay the provider
 * never configured. Neither arm here can read the other's source, so the pair
 * cannot be assembled at all.
 *
 * `scopeOf` is a function rather than a value because the caller's options are
 * accessors: which scope the seam names may change between reads, and `P18`
 * depends on exactly that for the client.
 */
type OwnerInputs = {
  /** The capability the request reaches the transport through. */
  readonly transport: TransportCapability;
  /**
   * `scope` and `environment` take the refusal machinery's `read`, because an
   * unreadable one of them is a refusal a consumer has to be told about; the
   * rest are read where a getter has no error channel and go through
   * {@link safely}.
   */
  readonly scopeOf: (
    read: <T>(name: string, of: () => T) => T | undefined,
    opts: { scope?: RelayScope | undefined }
  ) => RelayScope | undefined;
  readonly environmentOf: (
    read: <T>(name: string, of: () => T) => T | undefined,
    opts: { environment?: 'browser' | 'server' | undefined }
  ) => 'browser' | 'server' | undefined;
  readonly clientOf: () => QueryClient | undefined;
  readonly verifierOf: () => ((event: Nostr.Event) => Promise<boolean>) | undefined;
  readonly clockOf: () => ExpiryClock | undefined;
  readonly attemptsOf: () => AttemptRegistry | undefined;
  /**
   * The provider's host hints, and `undefined` for a caller-owned request.
   *
   * **Not an option on the bag**, deliberately: the listeners are the
   * provider's resource and a caller has no way to own one. A standalone
   * request gets no recovery, which is the same shape every other provider-only
   * capability has here.
   */
  readonly resumeOf: () => ResumeHints | undefined;
};

/**
 * Every input that decides what a request contains or which entry it is,
 * resolved **as one bundle from one owner**.
 *
 * **Two of the seven used to be bundled and the other five fell back field by
 * field, and an outside reviewer measured what that costs.** Under a provider,
 * two hooks over the same descriptor with different `verifyEvent` share one
 * cache entry; whichever mounted first ran the query function, so the answer
 * both consumers saw was **decided by mount order** — the accepting hook showed
 * the event to the rejecting one, and the other order showed neither. That is
 * `OM1`, and it is the counterexample this type exists to make unconstructible.
 *
 * **The rule is isolation, not completeness**, and the difference is a ruling
 * rather than a nuance. In **this spike**, a caller who supplies any owner
 * input is served by an arm that reads **no field of any provider** — it asks
 * which side it is on, takes the relays the caller's own client carries when
 * no scope is given, treats an absent clock as no expiry judgement, and
 * refuses the four it cannot resolve. `A16` withdrew that arm from v1: nothing
 * published takes an owner input and the port keeps no constructor for one, so
 * what follows is a measurement of this branch rather than a rule a port
 * implements. Requiring all seven was
 * the first answer and it is the wrong one: it would make a caller write a
 * clock and a scope whose absence has a meaning, and completeness is not what
 * keeps the two apart. Neither arm can read the other's source — the provider
 * arm reads one object minted by the provider, the standalone arm reads the
 * option bag — so a provider's transport beside a caller's verifier cannot be
 * assembled.
 *
 * `reqIdBase` is deliberately not in here: it partitions identity rather than
 * deciding content, so two requests that differ in it cannot collide in the
 * first place.
 */
type RequestRuntime = ({ readonly owner: 'standalone' } | { readonly owner: 'provider' }) &
  OwnerInputs;

export function useStreamedReq(getOpts: () => UseStreamedReqOpts) {
  /**
   * Read here, once, because here is the only window reading it is allowed in.
   *
   * **Both users of it are repaired together, and that is not tidiness.** With
   * only `refresh()`'s read moved, the request gets past the first statement
   * and the stream function's `verifyEvent` read throws instead — measured, and
   * what the consumer then sees is not the rejection but
   * `{kind: 'error', error: <Svelte error>}`: a failure of the *attempt*,
   * arriving on the outcome channel, indistinguishable from a relay that went
   * down. A partial repair does not shrink this defect, it disguises it.
   *
   * **Whether a provider is consulted at all is one question now, asked of
   * seven fields.** It used to be asked of two — the environment and the
   * verifier — and the other five fell back one at a time, which is how a
   * provider's transport came to serve a caller's verifier. The condition is
   * below, beside the bundle it decides.
   */
  const supplied = getOpts();

  /**
   * The capability this request reaches the transport through.
   *
   * **A provider's capability when the hook consulted a provider, and one over
   * the caller's own client when it did not.** The published surface is a hook
   * under a provider, and there the client is the provider's to take back; the
   * spike's low-level seam takes an `rxNostr` from the caller, who owns it, and this
   * library cannot say "the owner is gone" about a client whose owner is them.
   * `lease.ts` says why a capability exists at all — a request that *holds* the
   * client can only learn of the disposal by using it, which is a
   * check-then-use, and a lease that hands the client back is the same hole one
   * indirection along.
   *
   * **The condition is `provider`, and that is the ownership rule rather than a
   * coupling.** It reads as one — whether the transport is governed by the
   * provider would depend on whether a `verifyEvent` was passed — but it is the
   * same line `LC3` draws: a caller who supplies the provider's inputs is not
   * asked where it stands, and one who brings their own verifier *and* their own
   * client has opted out of the provider for both. The client is theirs, so the
   * capability over it is one nobody here can revoke and an unusable one is
   * refused by the name of the seam. `RM8` had to be rebuilt around this: it
   * supplied a verifier and never put its context where a hook looks, so it was
   * on the caller's side of that line while its title said provider.
   *
   * **The provider is read once and the caller's client is read every time.**
   * Which of the two this is, is decided at construction: a hook is under a
   * provider or it is not, and that cannot change under it. *Which client* the
   * seam names can — the option is a thunk, and `P18` moves a live request from
   * a dying client to a healthy one by returning a different one — so the caller
   * branch defers the read to each operation, exactly as the raw destructure it
   * replaced did.
   */
  /**
   * **Who owns the transport and the relays it is asked for — decided once, as
   * one bundle.**
   *
   * These two were resolved field by field: the transport took
   * `provider?.transportLease ?? callerTransport(...)` and the scope was read
   * from the caller's options with no provider fallback at all. An outside
   * reviewer drove the consequence end to end: a request under a provider,
   * handed a scope the caller invented, made **the provider's own client** open
   * a connection to a relay the provider never configured — the foreign relay
   * received the `REQ`, the provider's connection table grew, and the client the
   * caller was holding stayed empty. `0004` said that could not be produced
   * without holding the client C6 says a consumer never holds; it could.
   *
   * A ruling asked for the fix to be structural rather than a check: pick the
   * owner once and take that owner's bundle. So this is a union with two arms
   * and no way to write a third — a provider's transport cannot arrive beside a
   * caller's scope, because the arm that has the one does not read the other.
   *
   * **Everything that decides content or identity is in the bundle now**, which
   * it was not: for one round it held the transport and the scope while the
   * verifier, the environment, the client, the clock and the attempt registry
   * each fell back on their own. `OM1` is what that cost — two hooks, one
   * descriptor, two verifiers, and the answer decided by mount order.
   */
  const brought = (of: () => unknown): boolean => {
    try {
      return of() !== undefined;
    } catch {
      // **A getter that throws is a field the caller has.** Reading it is a
      // different question, and one this decision must not answer for them: a
      // caller whose `environment` getter throws meant to supply an
      // environment, and treating that as "brought nothing" would serve them
      // from the provider while a readable one makes them the owner. `SS6`'s
      // unreadable half is the arm.
      return true;
    }
  };
  /**
   * Whether the caller brought owner inputs of their own.
   *
   * **Named field by field rather than enumerated**, for `OF2`'s reason: a key
   * travels only because some line names it, and a loop over the caller's
   * object is exactly the enumeration that rule forbids. A getter that throws
   * makes this `true` by way of `safely` answering `undefined` for it and the
   * disjunction ending `?? true` — a caller whose options cannot be read is not
   * one this hook may quietly serve from a provider.
   */
  const callerBrought = (safely(
    () =>
      brought(() => supplied.rxNostr) ||
      brought(() => supplied.client) ||
      brought(() => supplied.attempts) ||
      brought(() => supplied.verifyEvent) ||
      brought(() => supplied.environment) ||
      brought(() => supplied.clock) ||
      brought(() => supplied.scope)
  ) ?? true) as boolean;
  // **Through `captureProvider`, not around it.** Written as
  // `callerBrought ? undefined : captureProvider(true)` for one round, which
  // left that helper's own condition constant — and the ledger measured it: the
  // entry that reads the context "whether or not it is needed" stopped killing
  // anything, because there was no longer a `needed` that could be false. A
  // mutation that goes quiet is the signal that its target has become dead
  // code.
  const provider = captureProvider(!callerBrought);
  const inputs = provider === undefined ? undefined : providerInputs(provider);
  const runtime: RequestRuntime =
    inputs === undefined
      ? {
          owner: 'standalone',
          transport: callerTransport(() => safely(() => getOpts().rxNostr)),
          scopeOf: (read, opts) => read('scope', () => opts.scope),
          // **Detected, not defaulted.** This read `?? 'browser'` through the
          // descriptor boundary, which is a fact about a machine written as a
          // default: on a server it makes a standalone request subscribe, and
          // `A12` says the server does not. A provider resolves its side with
          // `detectEnvironment()` and so does this — one detection, because two
          // are two facts waiting to disagree.
          environmentOf: (read, opts) =>
            read('environment', () => opts.environment) ?? detectEnvironment(),
          clientOf: () => safely(() => getOpts().client),
          verifierOf: () => safely(() => getOpts().verifyEvent),
          clockOf: () => safely(() => getOpts().clock),
          attemptsOf: () => safely(() => getOpts().attempts),
          resumeOf: () => undefined
        }
      : {
          owner: 'provider',
          // A server provider has no transport and says so in its type. The
          // capability built over nothing is the one a server request needs —
          // it refuses — and it is **not** the caller's, which is the mix this
          // whole type exists to prevent.
          transport: inputs.transport ?? callerTransport(() => undefined),
          scopeOf: () => inputs.scope,
          environmentOf: () => inputs.environment,
          clientOf: () => inputs.client,
          verifierOf: () => inputs.verifyEvent,
          clockOf: () => inputs.clock,
          attemptsOf: () => inputs.attempts,
          resumeOf: () => inputs.resume
        };
  const transport: TransportCapability = runtime.transport;
  /**
   * The two owner inputs a request cannot be built without, read through the
   * bundle and never off the option bag.
   *
   * Accessors rather than values because the caller's options are accessors:
   * which client the seam names may change between reads, and `P18` depends on
   * exactly that.
   */
  /**
   * A cache and a registry of this hook's own, built only to carry a refusal.
   *
   * A caller-owned request whose owner brought no client has nowhere to publish
   * anything — `createQuery` needs a cache to live in before the refusal exists
   * — so it gets one that holds this entry and nothing else. Nothing is asked
   * of a relay on that path: {@link requestOf} names the missing input and
   * `resolveRequest` refuses the request by it.
   */
  let refusalHome: QueryClient | undefined;
  let refusalLanes: AttemptRegistry | undefined;
  const ownedClient = (): QueryClient => {
    const found = runtime.clientOf();
    if (found !== undefined) return found;
    refusalHome ??= new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return refusalHome;
  };
  const ownedAttempts = (): AttemptRegistry => {
    const found = runtime.attemptsOf();
    if (found !== undefined) return found;
    refusalLanes ??= createAttemptRegistry();

    return refusalLanes;
  };
  /** The owner inputs a caller-owned request is missing, named for the refusal. */
  const incompleteOwnerInputs = (): string[] =>
    runtime.owner === 'provider'
      ? []
      : [
          runtime.clientOf() === undefined ? 'client' : undefined,
          runtime.attemptsOf() === undefined ? 'attempts' : undefined
        ].filter((name): name is string => name !== undefined);

  /**
   * The request as the boundary takes it, with the environment already decided.
   *
   * Named because both callers of {@link resolveRequest} need the same
   * resolution and one of them cannot make it: `refresh()` runs where a context
   * read throws. Deciding it here — at a point that closes over the captured
   * provider rather than reaching for the live context — is what lets the two
   * paths keep naming the same cache entry, which is the property the shared
   * call was there for in the first place.
   */
  /**
   * **Field by field, and never `{ ...getOpts() }`.** The spread was written
   * here first and `OF2` refused it, correctly: A4b makes the options an
   * allowlist, and the property that enforces it is that nothing on this path
   * *enumerates* the caller's object — a key travels only because some line
   * names it. A spread reads every key the caller happened to set, which is the
   * route by which an option upstream adds later arrives without anyone
   * deciding it should. The duplication below is the cost of that, and it is
   * the point rather than a smell: a new descriptor input has to be written in
   * `resolveRequest`'s parameter list *and* here, and `OF2` plus `PROV1` are
   * what notice when only one of the two happens.
   */
  const requestOf = (from?: UseStreamedReqOpts): Parameters<typeof resolveRequest>[0] => {
    // The caller's object is taken as an argument when the caller already has
    // it — `refresh()` does — so that one call of the thunk serves the whole
    // evaluation. Reading it twice is the defect this file keeps repairing one
    // field at a time.
    const opts = from ?? getOpts();
    // **The caller's object is read here, which is one frame above the
    // boundary's own guard.** `resolveRequest` reads what it is *handed*; this
    // is where the handing happens, so a getter that throws threw out of the
    // options factory — an exception in the render path rather than a refusal
    // on `state.error`, which is the shape the failure path was repaired for.
    // Found by a reviewer after that repair, one frame down.
    //
    // **A field that threw is absent *and* named**, and the name travels beside
    // the values rather than inside them. A sentinel *value* stood here for two
    // rounds and every reader of the descriptor domain then owed it a branch:
    // it was not `'server'` and not nullish on the side that decides who
    // publishes a refusal, it was neither a scope nor `undefined` where the
    // relays are resolved, and it rendered as JSON a consumer could have
    // written. Three of those became defects and two of the repairs had no
    // falsifier. The list below cannot leak, because nothing downstream reads
    // it except the refusal.
    //
    // Absent and unreadable still stay apart — that is what the list is for.
    // Folding them together refused every request with an optional field unset,
    // which is most of them (measured).
    const unreadable: string[] = [];
    const read = <T>(name: string, of: () => T): T | undefined => {
      try {
        return of();
      } catch {
        unreadable.push(name);
        return undefined;
      }
    };
    return {
      unreadable,
      // Named here so `resolveRequest` refuses by the same door every other bad
      // input goes through. Computed rather than captured: the caller's options
      // are accessors, so which inputs they have brought is a question with a
      // different answer per read (`P18`).
      incomplete: incompleteOwnerInputs(),
      // **Whether there is a provider at all**, which is a different question
      // from which inputs are missing: a caller who brought some and a consumer
      // who brought none both end up "standalone", and only the second one's
      // remedy is "put it under a provider".
      //
      // **Its two inputs are construction-time facts, and the field beside it is
      // re-read — that asymmetry is the design, not an oversight.** `incomplete`
      // is recomputed on every materialisation because the caller's options are
      // accessors and which inputs they bring is a question with a different
      // answer per read (`P18`). Who *owns* the request is decided once, at
      // construction: `callerBrought` and `provider` are bound there, so a
      // consumer cannot drop their owner inputs mid-flight and be adopted by a
      // provider — which is the sentence the refusal message states to them.
      noProvider: !callerBrought && provider === undefined,
      filters: read('filters', () => opts.filters) as Nostr.Filter[],
      live: read('live', () => opts.live),
      namespace: read('namespace', () => opts.namespace),
      // Resolved here rather than downstream: an `environment` nobody could
      // read is the provider's question, and the request is refused for the
      // field either way — but *who publishes the refusal* on a server is
      // decided from a side, and a side has to be a side.
      environment: runtime.environmentOf(read, opts),
      settleTimeoutMs: read('settleTimeoutMs', () => opts.settleTimeoutMs),
      retain: read('retain', () => opts.retain),
      // From the owner's bundle, never from whichever field happened to be set:
      // a provider's transport and a caller's scope are not constructible
      // together.
      scope: runtime.scopeOf(read, opts),
      // **Through the same guard as every other caller field**, and it is the
      // caller's rather than the owner's: `scope` is *where this provider can
      // read from*, `relays` is *where this request asks*, and only the second
      // is something a consumer writes on a descriptor. A getter that throws
      // makes the request refused by name, which is what the list is for.
      relays: read('relays', () => opts.relays),
      // Through the guard like every other caller field. A getter that throws
      // is not "asking": it is a request refused by name, which is what the
      // unreadable list is for.
      deferred: read('deferred', () => opts.deferred)
    };
  };

  /*
   * Where the sixth event used to be kept, and why nothing is held beside the
   * hook any more.
   *
   * It was a hook-local `$state`, which had to be keyed by hand so that a
   * descriptor change did not carry the previous request's ended leg onto the
   * next one (P18/P18b). Putting the record on the cache value removes the
   * question rather than answering it: the cache key already decides which
   * request a value belongs to, so there is nothing left to key.
   *
   * `lastRejection` was the last thing to survive that rule — a refusal found
   * in the options factory and acted on in `refresh()`. It is gone too: both
   * places run the boundary themselves now, which is the same one-mechanism
   * rule applied to the last exception to it.
   */
  /**
   * What the request is, as a named accessor.
   *
   * Named rather than written inline at the call below, because the call now
   * has two arguments and they answer different questions: this one is what is
   * being asked, the other is which cache it is kept in.
   */
  /**
   * The refusal a server render has to publish itself, because nothing else can.
   *
   * **On a server the query function never runs**, which is how a refused
   * descriptor reached a rendered page as the *loading* slot. Acceptance is
   * decided in `queryOptions` — deliberately, so that it is decided even when
   * the query never runs — but the refusal is *delivered* by the query function
   * rejecting, and that needs a subscription, which needs an `$effect`, which
   * the server compiler does not emit. Measured through Svelte's own server
   * renderer: `status: loading`, `activity: live`, and the refusal appearing
   * only after hydration. The three records that said otherwise (0002's A12,
   * `A12-C2`, 0004) were all held by one arm that runs in jsdom and reaches the
   * refusal through the subscription a server does not have.
   *
   * Written here and read by the projection, rather than the projection asking
   * the boundary again: a second call would read the caller's descriptor a
   * second time, and `B4-C7` is that a field is read once.
   *
   * Only on the server. In a browser the query delivers it, and a value written
   * during a derivation and read from a getter would be a second source for one
   * fact — this one is confined to the arm where there is no first source.
   */
  let refusedOnServer: ReqStateError | undefined;

  /**
   * What the query rejected with, as a value this channel can publish.
   *
   * **The query's rejection is an ingress and it was published raw.** Everything
   * this library throws into the query function is a `ReqError` now, but the
   * query library rejects with values of its own too — a cancellation, or
   * whatever a consumer's own accumulator threw — and `state.error` promised a
   * `code` for all of them. `capture` is the normalizer; ours passes through
   * with its class and its code, and anything else is copied.
   *
   * **It was memoised on the rejected value and the memo did nothing.**
   * Instrumented over the whole spike suite: 73 misses, and **every rejected
   * value was already library-owned**, so `capture` was a pass-through and the
   * memo cached its own key. Deleting it left the suite byte-identical. What it
   * could still do is go stale — error, success, error with the same object —
   * which is the defect the module-level memo in `own.ts` was removed for, and
   * it contradicted two sentences in this file that say `lastRejection` is gone
   * and that nothing is written during a derivation and read from a getter. So
   * it is gone, and this is a function of the query's state alone.
   */
  const rejectedWith = (): ReqStateError | undefined =>
    query.status === 'error' ? terminalFailure(capture(query.error, 'unspecified')) : undefined;

  /**
   * The plan the query is running under, as opposed to the one this moment
   * would produce.
   *
   * `refresh()` asked the *relay list* whether there was anywhere to ask, and
   * the query obeys the **plan** — computed when its options were last derived,
   * and `defer` (`enabled: false`) until the descriptor is evaluated again
   * (`P19c`, `P19d`). Relays arriving at the transport underneath do not move
   * it. So a `refresh()` after they arrived found targets, went on, and asked
   * for an attempt that would never begin: a rejection saying the request "is
   * disabled, or nothing is holding it any more", to a caller whose hook is
   * mounted and holding it.
   *
   * Read where the two facts have to agree. Written where the options are
   * built, for {@link refusedOnServer}'s reason: asking the boundary again
   * would read the caller's descriptor a second time.
   */
  let planned: RequestPlan = 'open';

  const queryOptions = () => {
    // **This destructure is a read of the caller's object too**, and it runs
    // before `requestOf()` does — so a `scope` getter that throws threw here,
    // one line above the guard written for it. Everything the boundary
    // type-checks is read through `requestOf` now, and `clock` is read through
    // the guard where it is used; what is left here is the **required seams**,
    // whose rule is in the paragraph above `safely`. This function is a thunk
    // and is re-evaluated, so a getter that throws on one of those is an
    // exception wherever the options are next derived — not "a hook that could
    // not be constructed", which is what this said and was wrong about.
    const given = getOpts();
    const attempts = ownedAttempts();
    const verifyEvent = runtime.verifierOf();
    const {
      reqIdBase,
      staleTime,
      consumeSignal = true,
      poisonId,
      passiveAbort = false,
      refetchOnMount,
      enabled,
      initialData,
      // A11's seam, defaulted here rather than at the call so that "what ships
      // is adapter A" is one statement and not one per use. See
      // {@link EngineRequest.accumulator}.
      accumulator = streamedQueryAccumulator
      // **One call of the caller's thunk here as well.** The repair that gave
      // `refresh()` a single call left this site with two — this destructure
      // and `requestOf()`'s own `getOpts()` — so the seams came from one
      // materialisation of the caller's object and the descriptor from the
      // next. A thunk that answers with a fresh object each call is the shape
      // `B4-C7` is written for, and here it would let the client the query is
      // built on and the client the descriptor was checked against be two
      // different objects. `WR19` counts the calls in this file.
    } = given;

    // Acceptance is decided here, not inside the query function, so that it is
    // decided even when the query never runs — on the server it does not
    // (A12), and input the API refuses is refused before "can we ask yet?" is a
    // question. Throwing from here would put an exception in the render path,
    // which is the shape of #80, so the failure is carried as a rejected query
    // function instead: same `status: 'error'`, no exception on the way through
    // the component.
    //
    // It is also the single boundary: the key, the plan and the wire filters
    // below read the normalized descriptor, never the caller's object.
    const request = requestOf(given);
    const { descriptor, rejection, key, deferred } = resolveRequest(request);
    // **The side is a side, always** — `requestOf` resolves an unreadable
    // `environment` against the provider's before this line sees it, which is
    // why this reads as it did before any of the guarding. It matters here:
    // on a server the query function never runs, so a refusal nobody published
    // would sit in the cache under a page rendering `loading`, which is the
    // A12 defect this field exists for.
    // **Or refused before any side is known.** An incomplete owner bundle is a
    // request that cannot run anywhere — the caller brought some of the seven
    // and not the client or the registry — so there is no side to wait for and
    // nothing that would ever deliver the refusal. On a server that is `SS6`'s
    // whole subject: a page rendering `loading` over a refusal already made.
    refusedOnServer =
      request.environment === 'server' || (request.incomplete?.length ?? 0) > 0
        ? rejection
        : undefined;

    // The relays this request is asked of, resolved here and used three times
    // below: counted for the plan, given to the machine as its target set, and
    // named on the wire. Resolved *with* the key rather than inside the query
    // function, so a client whose defaults move between the two cannot put one
    // scope's answers under another's key (SC13, SC14).
    // The scope from the guarded read rather than from the destructure above:
    // one read of the caller's field, and the refusal already made if it threw.
    //
    // **And guarded, because this runs in the options factory.** A disposed
    // provider makes the read of the client's default relays throw, and a throw
    // here is an exception in the *render path* rather than a refusal on the
    // channel — the shape every boundary in this file was repaired away from.
    // The refusal it becomes is the one `resolveRequest` would have made, so it
    // joins the same field: an entry that holds a failure and no data.
    // **The request's own set when it named one, and it is not a second
    // resolution.** `descriptor.relays` is what `resolveTargets` produced above,
    // already checked against this provider's readable set — so the relays the
    // key was built from and the relays the REQ goes to are the same array.
    // Only a request that named none asks the transport what it reads from.
    const asked = descriptor?.relays ?? safely(() => requestTargets(transport, request.scope));
    const targets = asked ?? [];
    //
    // **And it is a refusal of the *seam*, not a disposed provider.** A provider
    // that disposes its own client revokes the lease first, so no request gets
    // this far (`lease.ts`); what reaches here is a caller who handed this
    // library a client at the spike's low-level seam and then disposed it. `refresh()`
    // is where `provider-disposed` lives, and it is decided by the lease.
    //
    // **Two causes, one message, and the message named only one.** A standalone
    // request that brought no transport at all reaches here as well, and an
    // adversarial repair of `OM4` measured what it was told: "the client given
    // to this request has been disposed", about a client that was never given.
    const disposed =
      asked === undefined
        ? ownedByLibrary(
            new InvalidDescriptorError(
              'rxNostr',
              'could not be used — this request has no usable client: either none was supplied ' +
                'with the other owner inputs, or the one supplied has since been disposed'
            )
          )
        : undefined;

    // A refused descriptor plans as `open`, not as `defer`. That is what makes
    // A12-C2 hold: deferring would leave the query disabled and silent, and the
    // refusal has to surface wherever it was made. It also means `defer`
    // implies a descriptor, so the guard below needs no second condition — one
    // was there, and could never be false.
    // A disposed provider plans as `open` for the same reason a refused
    // descriptor does (`A12-C2`): deferring would leave the query disabled and
    // silent, and a failure has to surface where it was made. Without this the
    // request has no targets, defers, and sits at `loading` for ever — measured.
    const plan =
      descriptor === undefined || disposed !== undefined
        ? 'open'
        : planRequest(descriptor, targets.length);
    planned = plan;

    // **Handed the attempt rather than taking one.** This used to call
    // `attempts.begin()` itself, and that made the attempt boundary the *stream
    // function's* entry — which is a boundary A11's type cannot enforce. The
    // seam is "params to a `QueryFunction`", and nothing in that type makes the
    // returned function call this one; a type-legal accumulator that throws
    // first, or one whose factory throws, left the claim unclaimed and filed the
    // failure under an id nobody was waiting for. The claim is taken at the
    // query function's entry now, and this is handed the result.
    const streamFn = (attemptId: AttemptId, invocation: AbortController) => {
      // **No context, and that is what moving the read out of here bought.**
      // Query-core's cancellation reaches this machine through the invocation
      // controller, which is linked at the query function's *entry* (see
      // {@link linkCancellation}); the accumulator's own read is taken at the
      // seam, once per call rather than once per producer. Nothing this
      // function builds is configured by the caller's context — the machine
      // takes its lifetime from the invocation — so the parameter is gone
      // rather than kept and ignored, which is what made "a second call's
      // context is dropped" a question worth asking in the first place.

      // **The machine is bound to the invocation.** The engine owns one
      // `AbortController` per invocation so that a producer an accumulator
      // started and then walked away from is ended when the invocation ends,
      // and so that everything with an opinion about this request's lifetime —
      // query-core's cancellation, the return boundary, the `finally` — speaks
      // through one object.
      const signal = invocation.signal;

      // Only the satisfiable ones go out: an unsatisfiable filter riding along
      // in the OR array is stripped upstream and widens the request.
      //
      // `live` off the descriptor, not off the caller's object. They agree
      // today only because `normalizeDescriptor` throws on anything that is
      // not a boolean — which is a fact about this month's code, and 0003 says
      // the normalizer's output is the only thing the rest accepts.
      return twoStageStream({
        transport,
        filters: wireFilters(descriptor as NormalizedDescriptor),
        live: (descriptor as NormalizedDescriptor).live,
        targets,
        attemptId,
        attempts,
        reqIdBase,
        signal,
        passiveAbort,
        // **The wiring, and it did not exist.** The provider built a verifier,
        // put it on the context and nothing carried it any further: this hook
        // never read the context, so a request made through a provider ran with
        // whatever the caller happened to pass — which was nothing. 0004 said
        // the verifier is supplied "to the engine instead of to the client"
        // while no path from one to the other existed. `AE9` drives a forged
        // event through a provider-built request now, rather than calling the
        // context's verifier directly and proving only that the field is set.
        //
        // The caller's own wins, because a measurement that wants to watch the
        // gate reject has to be able to say so; the provider's is what every
        // request under a provider gets.
        //
        // **From the captured provider, and this line used to read the context
        // itself.** It runs synchronously from the query function's entry —
        // `experimental_streamedQuery` calls its `streamFn` before its first
        // `await` — so on a mount it was legal by accident, because query-core's
        // subscribe happens inside `createQuery`'s `$effect` and a reaction
        // restores the `component_context` it captured. On a re-fetch driven
        // from anywhere else it is not: measured through a request, the read
        // threw and the consumer was handed
        // `{kind: 'error', error: <Svelte error>}` — the attempt failing, on
        // the outcome channel, wearing the same shape a dead relay wears. That
        // is why this site and `refresh()`'s were repaired in one change and
        // not one at a time: moving only the other one converts a rejection a
        // caller cannot miss into an outcome they cannot tell from a network
        // fault.
        verifyEvent: verifyEvent ?? noVerifier(),
        settleTimeoutMs: (descriptor as NormalizedDescriptor).settleTimeoutMs
      });
    };

    /**
     * Query-core's cancellation, joined to this invocation at the query
     * function's entry.
     *
     * **It used to be linked inside {@link streamFn}, and that placement was the
     * seam's to honour rather than the engine's to own.** An accumulator that
     * never calls its stream function and simply stays pending was then reached
     * by nothing at all: query-core cancels a fetch whose observers have gone,
     * but only when the query function has *read* `context.signal`, and with the
     * only read inside `streamFn` an accumulator that never called it left
     * `abortSignalConsumed` false. `removeObserver()` fell back to
     * `cancelRetry()`, which does not abort; the invocation never returned, so
     * its `finally` never ran; and the attempt was never abandoned, so a
     * `refresh()` over it waited for ever behind a consumer that no longer
     * existed. Cancellation cannot be owned on the far side of a seam whose type
     * cannot require the seam to reach it — the same argument that moved the
     * attempt boundary to the entry, applied to the other end of the same
     * lifetime.
     *
     * **The argument for the old placement was M5, and it was the wrong way
     * round.** `consumeSignal: false` exists to reproduce #61, and linking here
     * unconditionally would read the signal for every query function and close
     * that failure mode as a side effect. That is a reason to exempt the option,
     * not a reason to place the shipping design's cancellation where a test-only
     * defect-reproduction path wants it: a measurement is worth what the code it
     * measures is worth. So the exemption is exactly one line wide — the normal
     * path links, `consumeSignal: false` declines to read the signal at all —
     * and M5 keeps reproducing the leak through the option that names it (M5's
     * shape is unchanged; see the measurement).
     *
     * **The attempt is abandoned here, by the engine, immediately.** Not left to
     * `twoStageStream`'s `finally`, which is the stream's mechanism and runs
     * only if there was a stream: an invocation cancelled before — or without —
     * reaching `streamFn` has no producer to unwind and still has a waiter. It
     * is idempotent with that `finally` and with the return boundary's abort
     * arm, and deliberately so: three mechanisms end an attempt and none of them
     * may depend on another having run.
     *
     * **It returns a disposer, and the `finally` releases it.** The listener
     * used to be left behind on every normal completion, and what that costs was
     * measured rather than argued, because the two answers are different fixes.
     *
     *  - *Retention, and it is real.* Counted by instrumenting
     *    `AbortSignal.prototype.addEventListener`/`removeEventListener` and
     *    reading the census for query-core's own signal — the one an accumulator
     *    is handed, so a test can hold the very object. One settled non-live
     *    request left **2** live `abort` listeners on it: this one and the
     *    fallback accumulator's own (`consumeAwareContext`, and upstream's
     *    helper does the same). **What attributes one of the two to this
     *    function is the before/after — 2 with the link, 1 with it released.**
     *    `consumeSignal: false` left **0**, which says something weaker and
     *    worth not overstating: both listeners depend on the signal being read
     *    at all, which is equally consistent with the accumulator adding two.
     *    Under `retry: 2` with two
     *    invocations throwing, **3** invocations left **4**: the accumulator's
     *    one, plus one per invocation, because a retry re-enters the query
     *    function against the *same* `AbortController` — query-core builds it
     *    once per `fetch()` and calls `fetchFn` again for each retry. So the
     *    accumulation is per invocation, and it is held for as long as the
     *    `Query` holds the retryer that closes over that controller.
     *  - *Not observable, and that is measured too.* After the invocation
     *    resolves, nothing can fire this listener: query-core's only route to
     *    `abortController.abort()` is the retryer's `onCancel`, and `cancel()`
     *    returns without calling it once the thenable has settled. Tearing the
     *    consumer down after a settled request left the signal **unaborted** and
     *    called nothing. So the fix is hygiene — bounded retention of one
     *    controller, one closure and an `AttemptId` per invocation until the
     *    entry's next fetch or its garbage collection — and not a defect any
     *    published surface can be made to show. It is recorded as hygiene for
     *    that reason rather than witnessed by an assertion that would be passing
     *    for some other reason.
     *
     * **Releasing on the invocation's exit does not drop a late cancel**, and
     * the window is worth naming rather than waving at. A cancel arriving after
     * the `finally` is by definition after the invocation ended, and the return
     * boundary has already given the attempt an ending on every path out: a
     * terminal outcome on the returned value, an abandonment on the abort arm,
     * an {@link AccumulatorContractError} when neither, or a failure recorded in
     * the `catch`. What this listener would still have done in that window is
     * abort the lifetime for an attempt that has already reported — and
     * {@link backlogOutcome} resolves on the cache *write* that carries the
     * outcome rather than on the abandonment, and re-reads the value before
     * believing an abandonment anyway. So the attempt in that window loses
     * nothing; it is answered by the outcome it already has.
     *
     * The invocation that never leaves is the case this deliberately does not
     * touch: its `finally` has not run, so its link is still in place, which is
     * the whole reason the link is here rather than inside {@link streamFn}.
     */
    const linkCancellation = (
      cancellation: AbortSignal,
      attemptId: AttemptId,
      invocation: AbortController
    ): (() => void) => {
      const cancelled = (): void => {
        // **The event is what woke this, and the signal is what it believes.**
        // An `abort` listener fires for any dispatch, and the object dispatching
        // is one the accumulator holds, so the event says only that somebody
        // asked. What decides is {@link trulyAborted}, which reads the internal
        // slot the platform's own abort algorithm sets — the one thing here
        // that the far side of A11's seam can neither dispatch at nor shadow.
        //
        // Reached by a forgery and by nothing else on the shipping path: every
        // real cancellation aborts before it dispatches, so this returns early
        // only for an event that was manufactured. Measured both ways round —
        // with the read absent a forged event produces the whole stopped-request
        // surface, and with it present the same accumulator reaches the return
        // boundary's contract failure — and the entry that removes it is
        // `forged-abort-event-passes-for-a-teardown`.
        if (!trulyAborted(cancellation)) return;
        invocation.abort(trueReason(cancellation));
        attempts.abandon(
          attemptId,
          'refresh() was waiting for an attempt its consumer cancelled. The query function ' +
            'was torn down — a consumer that went away, a fetch cancelled to make room for a ' +
            'later one, or an entry that was reset — before the attempt reached an outcome.'
        );
      };
      // **Asked the same way, and that is the correction applied as a class
      // rather than at the line the forgery came in by.** A retry re-enters the
      // query function against the *same* `AbortController` query-core built
      // for the fetch, so this entry read is made against a signal a previous
      // invocation's accumulator has already had in its hands. An own `aborted`
      // property answering `true` would take this branch, and — since the read
      // above is honest — `cancelled()` would then do nothing and **no listener
      // would be attached at all**, which is the unlinked invocation this whole
      // function exists to prevent. Reading the slot is what makes the branch
      // and the listener agree about the same fact.
      if (trulyAborted(cancellation)) {
        cancelled();
        // Nothing was attached, so there is nothing to release. A disposer
        // rather than an absent one so that the caller has one shape to hold:
        // "linked" and "already cancelled at the entry" are the same statement
        // about this invocation's lifetime and only differ in what is left to
        // undo.
        return () => undefined;
      }
      cancellation.addEventListener('abort', cancelled, { once: true });
      return () => cancellation.removeEventListener('abort', cancelled);
    };

    /**
     * How a chunk becomes the next value — A11's other parameter.
     *
     * Built with the options rather than inside the query function, for the
     * reason {@link streamFn} is: it is a function of the descriptor and the
     * clock, and of nothing the invocation carries. What the invocation carries
     * is the attempt, and that is the one thing passed in below.
     */
    const reduceChunk = (acc: Collected, chunk: Chunk): Collected => {
      if (poisonId !== undefined && chunk.type === 'event' && chunk.packet.event.id === poisonId) {
        throw new Error(`collect failed on ${poisonId}`);
      }
      // The descriptor's bound, not the caller's field. This read the raw one,
      // so the value the fold used and the value the key names came from two
      // places. They agree today because the normalizer resolves an absent
      // `retain` to `'unbounded'` and refuses everything else — which is exactly
      // the reasoning 0003 says the rest of the library must not depend on.
      //
      // **Sampled for its effect, not for its value**, and the distinction is
      // the whole of what changed here. Retention stopped ranking by expiry, so
      // the instant is read by nobody on this path and passing it would be an
      // argument the callee ignores — which is worse than noise, because it
      // tells a reader the bound depends on something it does not.
      //
      // **Deleting the call along with the argument is the mistake this comment
      // exists to stop.** `clock.now` moves only when a timer fires, and
      // `wakeAt` declines to arm one for a deadline already past relative to it
      // (`at <= now`), computing its delay from that same instant otherwise. So
      // an event that arrives already expired against the real clock, but not
      // against a stale `now`, is projected as visible and stays visible for a
      // delay measured from the stale instant. Sampling here is what makes the
      // projection judge an arriving event against the instant it arrived at.
      //
      // Measured rather than argued, and the measurement corrected the guess:
      // with this line removed and the argument still gone, `EX1` still passes
      // — it moves the source and lets a timer notice — and **`EX8`** fails,
      // leaving an event whose deadline passed while nothing was scheduled in
      // the answer. `EX8` is the one that holds the source still and arms no
      // timer, so the sample is the only thing that can notice, which makes it
      // the falsifier for this line.
      //
      // Its name has outlived its subject: it says "the instant *retention*
      // judges against", and retention judges against no instant now. What it
      // witnesses is the projection, and renaming it belongs to whoever owns
      // that file this round.
      // Read through the guard, like the other two places this seam is read:
      // it is optional, and a getter that throws makes it absent rather than
      // making the request fail. See the paragraph on which reads are guarded.
      sampleNow(runtime.clockOf());
      return collect(acc, chunk, { retain: (descriptor as NormalizedDescriptor).retain });
    };

    return {
      queryKey: key,
      // Caller-supplied options first, the library's own last. A4b is not only
      // "which keys are accepted" — the order the values are applied in is part
      // of the structure. With the library's `enabled: false` written before
      // the caller's `enabled`, passing `enabled: true` alongside
      // `environment: 'server'` switched A12 off.
      ...(staleTime === undefined ? {} : { staleTime }),
      ...(refetchOnMount === undefined ? {} : { refetchOnMount }),
      ...(enabled === undefined ? {} : { enabled }),
      // **Not while the plan is deferred.** Every deferred hook on a client
      // shares one inert entry, so a seed written into it is a seed the *other*
      // deferred hooks read — and it is data under a key that stands for "no
      // question". `initialData` is a spike-only switch, which is why this is a
      // narrow branch rather than a published rule; what it makes true is that
      // the shared entry holds nothing by construction rather than because
      // nobody tried. `PL5` is the arm.
      ...(initialData === undefined || deferred ? {} : { initialData }),
      // On the server the query is not run at all, which leaves it `loading`
      // with no REQ behind it — "not asked" rather than "asked and empty". A
      // refused filter is different: it is refused whether or not we can ask.
      ...(plan === 'defer' ? { enabled: false } : {}),
      // **Last, so nothing a caller passed can switch a deferred plan on.** The
      // `enabled` above is `A12`'s and the caller's; this one is the plan
      // itself, and a plan that is not asking is not a query that could be
      // enabled — which is the difference between this and the `enabled` option
      // `A4` keeps out of a consumer's reach.
      ...(deferred ? { enabled: false } : {}),
      queryFn: async (context: unknown) => {
        if (rejection !== undefined) throw rejection;
        // The provider went away before the request could be planned. Thrown
        // *here* rather than where it was noticed, because the options factory
        // is a derivation and a throw in one is an exception in the render path;
        // from inside the query function it is a failure on the channel, like
        // every other refusal.
        if (disposed !== undefined) throw disposed;

        // Nothing to ask for: settled and empty, at the cost of no REQ.
        //
        // It still runs under a named attempt. The answer is known without
        // asking, but "known" has to be attributable or a `refresh()` over such
        // a request waits for an id nothing ever writes — it took the claim
        // before this branch and would then wait it out. Claimed the same way
        // the stream does, so the two paths hand the caller the same promise.
        if (plan === 'empty') {
          const attemptId = attempts.begin(hashKey(key));
          return endBacklog(beginAttempt(emptyEventSet, attemptId), attemptId, {
            kind: 'complete'
          });
        }
        // Through the seam rather than at the helper: the accumulation is the
        // *only* thing the two implementations differ by, so a parameter
        // written for one of them would be a difference the parity suite could
        // not see. A11's escape route is this call, and nothing above or below
        // it. There is no `refetchMode` here and no spike option that could
        // supply one — A2 is fixed inside {@link streamedQueryAccumulator},
        // the adapter that names the helper, so "the wrapper pins the mode" is
        // one statement in the one place the mode exists.
        //
        // **Construction is inside the `try`, and that is half of the move.**
        // Building the accumulator stood outside it, so a factory that threw
        // synchronously bypassed the record entirely — no failure on the value,
        // and nothing on the entry but query-core's own error. Construction and
        // execution are one attempt and are caught together.
        //
        // The stream function is handed this invocation's attempt rather than
        // taking one of its own. That is the other half: the seam cannot be
        // required to reach it, so nothing the engine needs may depend on it
        // being reached. There is also no cast — the seam names the context it
        // hands a stream function, and the cast that used to be here was load
        // bearing in the wrong direction: it let the helper's context shape and
        // this function's disagree silently.
        //
        // **Entry into the query function is the start of the attempt.**
        //
        // It used to be entry into the *stream* function, which is one call
        // deeper and on the far side of A11's seam. The seam's type is "params
        // to a `QueryFunction`", and nothing in that type makes the returned
        // function call the stream function at all — so a type-legal
        // accumulator that threw first, or one whose factory threw before
        // producing a function, ran a whole attempt that no claim was attached
        // to. Attribution was then correct only *after* `streamFn` was reached,
        // which is a cooperation between the two sides of the seam rather than
        // a property of the engine.
        //
        // Measured before it was changed, because the failure mode is not the
        // one it looks like: `refetchQueries` swallows the rejection
        // (`throwOnError` is unset, so query-core `.catch(noop)`s it), the
        // trigger *resolves*, and `refresh()` came back rejected with "asked for
        // an attempt that never began" rather than hanging. Wrong on both
        // halves — an attempt did begin and it did fail, and C11 says a failure
        // of the attempt is an outcome rather than a rejection of the call.
        //
        // Per invocation, which is why it is a `const` here and not a `let`
        // beside the options: the options are evaluated once and the query
        // function they carry runs many times against that one closure — a
        // cancelled fetch's stream can still be unwinding while its replacement
        // is opening — so a shared slot would let one invocation stamp its
        // failure with another's id.
        //
        // The lane is the cache entry rather than this hook, because the query
        // function that runs for a key is whichever observer of that key set the
        // options last, whoever asked for the refetch (`SEN11`) — so a slot held
        // beside one hook would give its id to an attempt another hook's
        // function started, and the caller would wait for an id nothing ever
        // stamps. Nobody claimed means nobody is waiting, and `begin()` mints in
        // that case: mount, remount and a refetch the library did not ask for
        // all land here.
        //
        // **This used to cite `SEN9`, which was that sentinel's id until the
        // collision with the rx-nostr relay-cap measurement was found and it was
        // renumbered.** `attempt.ts`'s module comment carries the same
        // correction; the rename reached the records and left both lib citations
        // pointing at a measurement about subscription caps.
        const attemptId = attempts.begin(hashKey(key));
        // **The producer's lifetime is the invocation's, and the engine owns
        // it.** One controller per invocation, aborted in the `finally` below
        // however the invocation leaves — returning, throwing, or the
        // accumulator's factory throwing before it produced a function at all.
        //
        // It exists because the *value* the invocation returns cannot answer
        // what it left running. r14's boundary asked only "does anything on the
        // returned value carry this attempt's id", which is a true question
        // about the waiter and a false one about the producer: an accumulator
        // that pulls its stream once and returns without closing the iterator
        // has genuinely opened a REQ, and every other end of that REQ's life is
        // out of reach. `context.signal` is not aborted, because query-core
        // cancels a query function that *failed* and this one succeeded;
        // `iterator.return()` is never called, so `twoStageStream`'s `finally`
        // never runs; and the machine is left suspended with a live
        // subscription. The reviewer wrote that accumulator and it survived the
        // whole suite. This is what ends it.
        //
        // Aborting is enough because the machine listens: `referenceStream`
        // registers an abort handler that closes every subscription it opened
        // and clears the settle timer, so the wire is closed at the moment of
        // the abort rather than whenever somebody next pulls the generator —
        // which is what "a suspended producer" makes impossible to rely on.
        //
        // **It is also the discriminator the return boundary reads**, and that
        // is a second job it turned out to be the only thing able to do. See
        // the boundary below.
        const invocation = new AbortController();
        // **The stream is a capability the engine lends, not a producer it hands
        // over.** Minted with the controller above and withdrawn on the same
        // line it is aborted, because they are one lifetime said twice: the
        // abort closes what the producer opened, and this stops the accumulator
        // reaching the producer at all.
        //
        // It exists because the abort alone could not say what 0002 claimed.
        // Singularity used to rest partly on `twoStageStream` being an
        // `async function*` — a generator is its own iterator, so an acquisition
        // could not open anything — and that step does not survive the shape
        // changing: an `AsyncIterableIterator` may return the identical object
        // from every `[Symbol.asyncIterator]()` and open a subscription on each
        // one. The property was a fact about our producer rather than a contract
        // anything could port. It is the engine's now, and it holds against a
        // producer that would fork. See {@link oneShotStream} for the four
        // properties and for what would disprove each.
        //
        // **`streamFn` is reached through this and nowhere else**, which is what
        // makes the one call and the one acquisition properties of the object
        // instead of counts read at a settlement a pending invocation never
        // arrives at.
        const capability = oneShotStream(() => streamFn(attemptId, invocation));
        // The other end of that lifetime, joined at the entry rather than
        // wherever the seam happens to reach. See {@link linkCancellation} —
        // the read of `context.signal` this makes is what arms query-core's own
        // cancellation, and `consumeSignal: false` is the one path that declines
        // it.
        //
        // **The exemption stays exactly one expression wide.** `undefined` here
        // is "nothing was linked, so there is nothing to release", which is the
        // same one line M5 needs and not a second branch in the `finally`: the
        // unlinked path has no listener to leave behind, so it is already what
        // the release is for.
        const unlinkCancellation = consumeSignal
          ? linkCancellation((context as { signal: AbortSignal }).signal, attemptId, invocation)
          : undefined;
        try {
          const inner = accumulator({
            initialValue: initialCollected,
            reducer: reduceChunk,
            // **Called synchronously**, and the race it used to be about is
            // gone. This was the only place `context.signal` was read, and
            // query-core decides between `cancel()` and `cancelRetry()` on
            // whether it has been read by the time the observer goes away — so
            // an `async function*` wrapper here, whose body does not run until
            // the first pull, moved that read several microtasks later and lost
            // the race for a consumer torn down promptly. Measured: `P37`
            // stopped rejecting and the request outlived its consumer, which is
            // #61 and exactly what M5 exists to watch. The read is at the query
            // function's entry now ({@link linkCancellation}), which is strictly
            // earlier than any of that and does not depend on this call being
            // made at all — the whole point of the move.
            //
            // A wrapper generator stood here for a round, taking a note in its
            // `finally` so the boundary below could ask whether the stream had
            // unwound. The note answered a question the boundary does not have;
            // see there. It is gone.
            //
            // **The read is here rather than inside the producer, and that is
            // where the capability moved it.** `oneShotStream` opens once, so a
            // read taken inside what it opens is a read taken on the *first*
            // call and on no other — and this one is the read an accumulator
            // that wraps its context is entitled to have made against the
            // wrapper it passed (the fallback's `consumeAwareContext`, and
            // upstream's helper). Whether the shipping adapters ever call twice
            // is not the question: "they only call once" is the argument this
            // seam has been wrong about every round it was made, and one line
            // here means it does not have to be made. What arms query-core's
            // own cancellation is the entry link and not this, which is why
            // moving it costs nothing else.
            //
            // `consumeSignal: false` still reads nothing at all, and the
            // exemption is the same one expression it is at the entry — M5
            // reproduces #61 through this path unchanged.
            streamFn: (streamContext) => {
              if (consumeSignal) void streamContext.signal;
              return capability.stream(streamContext);
            }
          });
          const data = (await inner(context as never)) as Collected | undefined;
          // **The return is a boundary too, for the reason the entry became
          // one.** Moving the claim to the query function's entry closed the
          // accumulators that *throw* without reaching `streamFn` and opened the
          // ones that *resolve* without reaching it — `({ initialValue }) =>
          // async () => initialValue` is type-legal, and it is the shape any
          // short-circuit in an alternative accumulator has (a cache hit, a
          // stub, a "return what we have" branch). Nothing else caught it.
          // A-γ's settle timer lives inside `referenceStream`, so with no
          // machine there is no timer and no end; `twoStageStream`'s `finally`
          // never runs, so nothing abandons; and the `started.then` rescue below
          // asks `attempts.begun(mine)`, which the claim at the entry has made
          // **true**. So `refresh()` hung, a second call joined the same flight
          // (`flights.delete` is in the flight's own `finally`), and the request
          // became permanently un-refreshable behind a spinner.
          //
          // **A failure of this attempt, not a rejection of the call**, and
          // that is the half r14 put on the wrong side of C11. It abandoned the
          // claim here, which rejects `refresh()` with an abort and — on a first
          // mount, where no `refresh()` is waiting at all — does nothing
          // whatever: the invocation returned normally, so the entry became
          // `status: 'success'` over a value with nothing in it, and the public
          // surface said `streaming([])` with `activity: idle`. A spinner over a
          // request that had stopped, which is the defect class the round before
          // had just closed.
          //
          // C11 divides on whether an *attempt* ran, and 0002 decides that
          // entry into the query function is where one starts. Both halves of
          // that were already written down; putting them together is all this
          // is. An invocation that entered, ran, and produced nothing anything
          // can wait on is an attempt that went wrong — an outcome, on the
          // resolving side, reported through the same record every other failure
          // of an attempt is reported through. The alternative the reviewer
          // named and rejected is to move the boundary instead: define the
          // attempt as starting when the stamp appears, which is coherent but
          // takes `A11-C7` and `A11-C8` — the accumulators that *throw* before
          // reaching `streamFn` — onto the call-rejection side with it, and
          // those are attempts that ran. The entry stays the boundary.
          //
          // **The exit space, since a list of accumulators has now been wrong
          // four times.** An invocation of this function leaves in exactly two
          // ways — it throws, or it resolves — because those are the two ways
          // any `async` function leaves. The throwing half is the `catch` below,
          // which records a failure under this attempt whatever threw. This is
          // the resolving half, and it is divided by facts the engine can read
          // here, not by a list of the accumulators anyone has thought of:
          //
          //  A. a terminal outcome for this attempt is on the value it returned
          //     — a backlog end or a failure under this id. Nothing to do; the
          //     waiter has its answer already.
          //  B. no terminal outcome, and this invocation was torn down. Abort.
          //  C. no terminal outcome, and nothing tore it down. Contract failure.
          //
          //  and the third case is the one that has no fourth: `A` is decided by
          //  reading two slots, and given `¬A` the invocation's own controller is
          //  either aborted or it is not. There is a state that is none of the
          //  three, and it is not a fourth case here: an invocation that never
          //  leaves has not reached this line at all. That one is bounded from
          //  outside, by {@link linkCancellation} — a consumer that goes away
          //  cancels it and the attempt is abandoned there — and a pending
          //  invocation whose consumer *stays* is bounded by nothing, whether
          //  it never opened the stream or opened it and stopped taking what
          //  it yields. It is stated rather than closed.
          //
          // **What the boundary rests on, said plainly: the value is the
          // accumulator's to construct.** Case `A` is a fact about the returned
          // value and never about the wire. The two come apart for a live
          // invocation that folds the backlog completion and returns with the
          // forward leg open — a true end is recorded and the request is not
          // over — and that case takes arm `A` here, correctly by this test and
          // wrongly by any account of the request. It is not repairable at this
          // line, because `refresh()` may already have resolved `complete` on
          // the very end that makes `A` true. What forbids it is a
          // postcondition of the two accumulators this library ships —
          // `A11-P2` in 0002, which holds the invocation open until the
          // iterator it is draining has exhausted itself, over a stream
          // `A11-P1` obliges it to have been taking all along. A live
          // request's stream is not entitled to finish at the backlog end,
          // because A5 ends it on the *last* leg and the forward one is not
          // always last, so this return is early. And the record no longer
          // claims A11 is correct by construction for any type-conforming
          // function.
          //
          // **`A`'s predicate has been wrong twice and the abort test once**;
          // both histories are on the record here and in 0002, because a
          // boundary that keeps moving is one a reviewer is entitled to see the
          // history of.
          //
          //  1. r14 asked `beganOnTheValue` alone and abandoned on `false`. That
          //     rejected `refresh()` where an attempt had run, and on a first
          //     mount did nothing at all — `success` over an empty value.
          //  2. r15 added "and the stream did not unwind", `producerUnwound`,
          //     read off a `finally` in a wrapper generator. **That predicate is
          //     false.** It answers "did the iteration end", and a stream that
          //     simply *finished* ends exactly as one that was torn down does:
          //     the machine yields its settle marker, `referenceStream` returns,
          //     `twoStageStream`'s `for await` completes and its `finally` runs.
          //     So the discriminator was true for the ordinary case and the
          //     boundary sent a real contract violation to the abort side —
          //     measured through a non-live request against a relay: an
          //     accumulator that drained the stream and returned `initialValue`
          //     produced `status: success`, `streaming([])`, the `loading` slot,
          //     no `lastError`, and a `refresh()` that *rejected* with an
          //     `AbortError`. Every one of the four witnesses aimed at this
          //     boundary left the stream un-unwound, so none of them could see
          //     it. `AC10` is the witness that does.
          //  3. r15 also kept `beganOnTheValue`'s four slots, and that is what
          //     r16 falsified: `running` and `forward` are stamped by the *first*
          //     chunk of an attempt, so an accumulator that folds one chunk with
          //     the reducer it was handed and breaks passed this test with no
          //     end and no failure anywhere — `streaming([])`, `idle`, the
          //     `loading` slot, and a `refresh()` rejecting with an abandonment.
          //     A stamp says a chunk arrived; the boundary needs the attempt to
          //     have *ended*. Two slots now, the same two the wait reads.
          //     `AC12` is the witness.
          //
          // The abort test is asked of the **invocation's own controller**,
          // which is the one thing that knows the difference: every legitimate
          // abort path — a torn-down consumer, a cancelled fetch, a superseded
          // generation, `refresh()`'s `resetQueries` — reaches this line with
          // the signal aborted, because query-core's cancellation is linked into
          // it at the entry. A stream that ran to its end, or that the
          // accumulator broke out of, reaches it unaborted. The `finally` below
          // aborts too, and strictly after this read.
          if (!leftATerminalOutcome(data, attemptId)) {
            if (!invocation.signal.aborted) {
              throw ownedByLibrary(
                new AccumulatorContractError(
                  'the accumulator returned without leaving an ended attempt to report. Its ' +
                    'query function ran and returned normally, the value it returned carries no ' +
                    "end and no failure of this attempt's, and nothing tore the invocation down, " +
                    'so nothing else is going to end it. A chunk having arrived is not an ' +
                    'attempt having ended: an accumulator that resolves without driving its ' +
                    'streamFn, that pulls the stream once and returns without closing it, that ' +
                    'folds some chunks and returns before the backlog ends, or that drives the ' +
                    'stream to its end and hands back a value its chunks were never folded ' +
                    'into, leaves exactly that. Anything the invocation started has been ' +
                    'closed with it.'
                )
              );
            }
            // The abort side, and it is idempotent rather than new: whatever
            // tore this invocation down also unwound the stream, so
            // `twoStageStream`'s `finally` has already abandoned this claim.
            // Said a second time here because the two boundaries are separate
            // mechanisms and this one must not depend on the other having run —
            // remove that `finally` and this is what still ends the wait.
            //
            // "There was a stream" is not an assumption here, which is what
            // makes reaching this arm safe for an accumulator that never called
            // `streamFn`. Since the cancellation link moved to the entry, the
            // two things that can abort this controller before the read above
            // are query-core's own cancellation and nothing else — the `finally`
            // below runs strictly after — so an aborted signal at this line
            // means the fetch was cancelled, whether or not a stream was ever
            // opened. That is a wider guarantee than the one this comment used
            // to make, and the wider one is the one the arm needs.
            attempts.abandon(
              attemptId,
              'refresh() waited for an outcome its query function did not produce. The ' +
                'attempt was torn down before it reached one — a consumer that went away, a ' +
                'fetch that was cancelled, or an attempt replaced by a later one on the same ' +
                'request — and the value carries no end of this attempt and no failure of it.'
            );
          }
          // Both adapters only write per chunk, so a stream that ends without one
          // leaves the cache undefined, which query-core rejects. Kept here rather
          // than pushed into the seam: an adapter that substituted a value of its
          // own would be answering for the engine, and this is the engine's
          // answer.
          return data ?? initialCollected;
        } catch (thrown) {
          // The one place a failure is visible with an attempt attached to it,
          // which is why the record is written here rather than derived from the
          // entry afterwards. It covers **every** way an attempt can throw, and
          // that is what the move above buys: the fold throwing part way through
          // a stream, the fetch failing before any value exists at all, the
          // accumulator's own query function throwing before it reaches
          // `streamFn`, and the accumulator factory throwing without returning a
          // function at all. The second of those is why the write seeds from
          // `initialCollected` — there is no previous value to fold onto — and
          // the last two are why construction is inside the `try`.
          //
          // Rethrown, not swallowed. The entry still has to become
          // `status: 'error'`: that is what stops the retry, what a consumer of
          // the raw query sees, and what {@link deriveDiagnostics} falls back to
          // for the one failure class that never reaches an attempt. Nothing
          // attributes an *outcome* to it any more — that is the record below.
          // `SEN22`(c) is what makes the record survive the rethrow — a rejected
          // fetch spreads the previous state and never writes `data`, so the
          // value this line just wrote is still there when the error lands on it.
          //
          // `context.signal` is deliberately not read here. Reading it would
          // consume the signal on behalf of a query function that did not ask
          // for one, which is what `consumeSignal: false` exists to measure
          // (M5) — and there would be nothing to learn from it: a cancellation
          // does not arrive as a throw. Both accumulators break their loop and
          // return the value normally when the signal fires, the machine returns
          // rather than throwing on abort, and query-core's `CancelledError` is
          // produced by the retryer outside this function.
          // **Through the ownership boundary, because this is the site the
          // descriptor's `catch` was repaired and this one was not.** A hostile
          // value thrown by an accumulator reached `instanceof` and `String()`
          // raw here, and then `noteFailure`'s bare `Object.freeze` — measured
          // by a reviewer as a `TypeError` replacing the caller's Error and the
          // failure never being recorded at all.
          const error = capture(thrown, 'unspecified');
          // `attemptId` and no fallback. There used to be a
          // `claim.attemptId ?? attempts.mint()` here, whose comment described
          // an attempt that threw before the stream function ran and so had
          // never taken a claim. That case cannot arise any more: the claim is
          // taken at the query function's entry, above every way this `catch`
          // can be reached, so the id is always this invocation's own. **The
          // fallback is deleted rather than left as a defensive `??`** — a
          // fallback whose comment describes an unreachable case is a record
          // that says something false, which is the class of defect this round
          // is about.
          //
          // "An id belonging to nobody" has not gone: it is what
          // `attempts.begin()` returns when no `refresh()` has claimed the lane,
          // which is the honest way to say it and is now the only way it is
          // said.
          ownedClient().setQueryData<Collected>(key, (previous) =>
            noteFailure(previous ?? initialCollected, attemptId, error)
          );
          throw error;
        } finally {
          // **Nothing this invocation started outlives it.** On the way out of
          // the `try` and on the way out of the `catch` alike, which is why it
          // is a `finally` and not a line at the end of each: the construction
          // of the accumulator, its execution, the boundary above and the
          // record below are all inside it, so a producer opened by any of them
          // is closed by this.
          //
          // A no-op on every path that already ended: a stream that ran to its
          // end has removed this listener, and a fetch query-core cancelled
          // aborted through the same controller a moment earlier. What it is
          // not a no-op for is the case the value cannot report — a stream
          // pulled once and abandoned, still holding a REQ, a live
          // subscription and the settle timer, with the query function already
          // resolved and query-core therefore never cancelling anything.
          //
          // **It also revokes rather than only closes, and that half is a
          // contract.** Everything the accumulator may still be holding — the
          // `streamFn` itself, the object one call returned, an iterator taken
          // from it — is one capability, and {@link oneShotStream} withdraws it
          // below. So a call, an acquisition or a pull taken *after* this line
          // opens no producer, puts no REQ on the wire, and **yields nothing at
          // all**. That is the second half of `A11-C10` (`AC21`), and it is what
          // makes singularity a structural fact rather than a count read once at
          // settlement: `A11-P1`'s witnesses cannot see an acquisition taken
          // later than themselves, and this is what covers the interval they
          // cannot reach.
          //
          // **The last clause used to be weaker, and the difference is a
          // decision rather than a tightening.** What the abort alone buys is
          // that nothing new *opens*: `referenceStream` returns on an aborted
          // signal before it subscribes. It does not empty the queue the machine
          // has already filled — the machine drains what it holds before it
          // checks that it has ended, deliberately, because a marker queued
          // behind an end is the state a `refresh()` waits on forever — so a
          // late pull could still be answered out of chunks queued before the
          // abort arrived. That is the whole of "nothing it started outlives it"
          // being true except for a drain. The queue is left exactly as it was;
          // what changed is that the answer no longer crosses the seam.
          //
          // Released before the abort rather than after it, which is a statement
          // and not an ordering requirement — nothing between the two lines can
          // yield, and aborting the invocation does not reach query-core's
          // signal in either direction. What it says is that this listener's
          // lifetime is the *invocation's*, and the invocation ends here. See
          // {@link linkCancellation} for what was measured and for the late
          // cancel this does not drop.
          // **Withdrawn before the wire is torn down**, and the order is a
          // statement rather than a requirement: nothing between these three
          // lines can yield, so no accumulator runs between them. What it says
          // is that the capability dies first, so no arrangement of the teardown
          // below can hand a chunk across the seam on its way out.
          capability.revoke();
          unlinkCancellation?.();
          invocation.abort(
            // **A private teardown note, not a value of the channel.** It is
            // `signal.reason` for an abort this library performs on its own way
            // out, nothing in the tree reads it, and it reaches no published
            // surface — measured. Giving it a `code` classified a cleanup
            // mechanism as a failure, and the *published* failure for a query
            // function that returned early already has one:
            // `accumulator-contract`.
            new Error(
              'nosvelte: the query function that opened this request returned, so anything ' +
                'it was still streaming is closed with it.'
            )
          );
        }
      }
    };
  };

  // The client, named. `createQuery` falls back to the ambient context when the
  // second argument is left out, which is how A15's client came to reach no
  // request at all: the provider built one and nothing installed it. See
  // {@link UseStreamedReqOpts.client}.
  const query = createQuery(queryOptions, ownedClient);

  // **Read once here so that it is read at all.** The query library notifies a
  // subscriber only about properties that subscriber has *touched* — the first
  // read of any property switches the observer from "tell me everything" to
  // "tell me about what has been asked for". Before this line there were two
  // readers — `activity`'s getter and `refresh()`'s test for a flight already
  // open — so a consumer that never read `activity` **and never refreshed** left
  // it untracked and its transitions never reached the value at all. That
  // conjunction is the defect's precondition and it is what a port needs;
  // "exactly one place" stood here for a commit and made the window sound wider
  // than it was.
  //
  // **This line is the third reader, and it is what makes the precondition
  // unreachable** — which is the repair. Any sentence that counts the readers
  // has to say three and say which; the count moved when this landed, and the
  // corrected sentence went stale in the commit that corrected it.
  //
  // Measured through the published surface, one variable, three runs each way:
  // with a single `void handle.activity` before a refused refresh, `activity`
  // afterwards answers `idle`; without it, `idle` never arrives and the handle
  // reports `live` over a subscription that is dead. That is the consumer's
  // *read history* deciding the answer, and the realistic shape — a spinner or
  // a retry button behind `{#if}` — is the stale one. `LC17` holds it.
  //
  // **All four, and touching only the broken one made it worse** — measured
  // again this round rather than quoted: touching `fetchStatus` alone leaves
  // `data` and `status` untracked and **37 tests across 9 files fail, 26
  // distinct arm ids**. The sentence here used to say "four arms", which was
  // the count on the day it was written.
  //
  // **Two of these four lines have no witness, and that is said rather than
  // implied.** Deleting `void query.error` or `void query.status` on its own
  // leaves the whole suite green — measured over 858 tests — while `void
  // query.data` alone kills twelve arms and `void query.fetchStatus` alone
  // kills eight. They are kept because the set a handle reads is what has to be
  // tracked and `status`/`error` are read by `deriveState`; what nobody has
  // constructed is a transition where one of them moves while `data` and
  // `fetchStatus` both stand still. Unwitnessed is not the same as dead, and
  // this is the honest verdict on them.
  //
  // The alternative, `notifyOnChangeProps: 'all'`, is on the library-owned list
  // and would re-notify on every property this library never reads.
  void query.data;
  void query.error;
  void query.status;
  void query.fetchStatus;

  // **The wake-up is armed here so that it is armed at all**, and the shape is
  // the one above's: unconditionally, at construction, rather than left to a
  // consumer having read.
  //
  // `clock.now` moves only when a timer fires, `wakeAt` is the only thing that
  // arms one, and its only caller was the projection's getter. So the scheduler
  // that keeps the projection honest was attached by the consumer's read: a
  // request nobody is looking at judges its events against the instant the last
  // chunk arrived, and the first read after a deadline shows what expired while
  // nobody looked — then arms a timer measured from that stale instant, so it
  // stays shown for that long again.
  //
  // Measured through the published surface, two runs differing in one
  // `void handle.state` taken while the event was still valid, on the clock a
  // browser provider builds: without it the handle answers
  // `settled|rh3-perishable` two seconds past the deadline, with it `settled|`.
  // `RH3` holds it. `EX2b`'s own claim — "it leaves on its own, without anything
  // else happening" — was true only because that arm reads the handle sixty
  // times while it waits; delete its reads and the event never leaves.
  //
  // **Not a sample inside the getter, and that is measured rather than
  // reasoned.** `sampleNow(clock)` there fixes the pair and leaves the whole
  // suite green — and makes an ordinary read of the handle a write of `$state`
  // from inside a derivation or a template expression, which Svelte refuses
  // outright (`state_unsafe_mutation`). No arm in this repository reads a handle
  // from either place, so the repair that breaks every consumer is exactly the
  // one the tests cannot see.
  //
  // Additive: `projected` still arms on read, which is all a handle held past
  // its own root has left (`LC10`, `LC11`).
  //
  // **What arming here costs, since the price moved with the decision.** There
  // is no branch that cancels: if the deadline this armed for stops existing —
  // the entry evicted, the value replaced by a refetch, the query gone to
  // `error` — the sleep already booked stays booked and fires once, waking every
  // reader of the provider's clock for nothing. It is self-correcting and it is
  // not free, and it is new: while the timer was armed by a read, a request
  // nobody looked at booked nothing at all. `C13-C4`'s bump is deliberately on
  // the branch that ends with nothing armed, so this costs one wake-up rather
  // than a loop.
  /**
   * Whether the root that created this handle has been released.
   *
   * **A cleanup with no dependencies, so it runs once and at the end.** The
   * effect below re-runs whenever the clock or the value moves, and its cleanup
   * runs on every one of those — which would report a release per re-render.
   * This one reads nothing, so Svelte destroys it exactly when the root does.
   *
   * A plain `let` rather than `$state`: nothing renders from it, and the one
   * reader is `refresh()`, which a consumer calls from a handler.
   */
  let released = false;
  $effect(() => () => {
    released = true;
  });

  /**
   * The recovery, and why a live request needs one at all.
   *
   * **Measured link by link.** rx-nostr's default retry is bounded
   * (`maxCount: 5`); retries exhausted is an `error`; an `error` on the forward
   * leg is terminal; and terminal is absorbing within an attempt (`A5`),
   * because a relay that reconnects does not revive a leg somebody else is
   * holding. So a laptop lid closed past five backoffs, a tunnel, or any gap
   * past the ceiling ends **every live feed on the page**, permanently — and
   * what reports it is a `settled` answer with events in it, which
   * `deriveOutlet` renders as `default`. Silence reading as health.
   *
   * **A new attempt, not a revived leg.** `A5`'s absorbing rule stays true
   * *within* an attempt; recovery is a refetch, which is the same thing a
   * `refresh()` is, so it enters the same single-flight rule and the data it
   * already has is kept. The alternative — reopening the ended leg — is
   * rewriting a terminal outcome after the fact.
   *
   * **Transport exhaustion and consumer-actionable refusal are separated.** A
   * leg that ended with refusals recorded ended because relays *said no* —
   * `auth-required:` is the commonest — and retrying that on a timer is a loop
   * against a relay that will keep saying no. A leg that ended with none is the
   * transport giving out, which is what a wait can fix.
   */
  $effect(() => {
    // Guarded like every other read of the caller's object: this one arms a
    // timer rather than answering a consumer, and a getter that throws here
    // would throw inside an effect, where nothing catches it.
    const clock = runtime.clockOf();
    if (clock === undefined) return;
    const { nextExpiryAt } = deriveState(
      {
        data: query.data,
        error: rejectedWith()
      },
      clock.now
    );
    if (nextExpiryAt !== undefined) clock.wakeAt(nextExpiryAt);
  });

  // **Not typed `ReqHandle`**, deliberately: what this returns carries `raw`
  // and `projected` beside the published members — the spike's inspection
  // seams, on no published list — and annotating the literal would refuse them.
  // The contract is `ReqHandle` and `SUR10`/`PO2` are what hold the extras off
  // the surface; this variable exists so the recovery can reach `refresh()`.
  const handle = {
    /**
     * The query library's own object — this repository's inspection seam, on no
     * interface and on no published list (0002, 0004, `PO2`).
     *
     * **Reading it is not free, and an arm that reads it before asserting on a
     * published member has changed what it is measuring.** Every property read
     * on the tracked result — including one through here — narrows the
     * observer's tracked set, so a `void handle.raw.data` above an assertion is
     * establishing the very subscription the assertion is about. Measured: two
     * arms differing only in that one statement answer `loading` and `settled`
     * under the mutation that removes the unconditional reads. Eighteen reads
     * of this member sit in four suites above assertions on published members.
     */
    get raw() {
      return query;
    },
    /**
     * The activity axis, and **one of three readers of `fetchStatus`** — the
     * other two are the unconditional touch at construction and `refresh()`'s
     * test for a flight already open. This said "the only place" while the
     * repair eight lines above the constructor said "two", which is what a
     * class sweep costs when it greps a phrase rather than enumerating the
     * fact. It is on a published member, so it is what a port reads in a
     * tooltip.
     *
     * **The one place the caller's `live` is read rather than the
     * descriptor's**, and the one axis on this surface that *defaults*: a
     * getter is not a place a refusal can be published from, so an unreadable
     * `live` answers "not live" here while the request itself is still refused
     * by name on `state.error`. Normalising here instead would put the
     * boundary's work in a getter, which is the shape of #80. Everything the
     * request is *made* of comes off the descriptor.
     *
     * The paragraph this replaces said the read was raw "and deliberately",
     * which stopped being true when the read was guarded and had stopped being
     * a reason before that: `resolveRequest` returns a rejection rather than
     * throwing one.
     */
    get activity() {
      // A refusal a server render is publishing is not something in flight: the
      // observer's `fetchStatus` is optimistic about a subscription that will
      // never happen, which is what made the not-asked report say `live` beside
      // a `loading` slot for a request the library had already refused.
      if (refusedOnServer !== undefined) return deriveActivity(false, false);
      // **A deferred plan is idle, and there is deliberately no branch here for
      // it.** One was written and deleted: `deriveActivity` answers `idle`
      // whenever nothing is fetching, a deferred plan is `enabled: false` so
      // query-core never fetches it, and disabling the branch left all four of
      // `PL1`–`PL4` green — an entranceless guard, which is a claim with no
      // witness rather than a defence. The server arm above is not the same
      // shape: there `fetchStatus` is optimistic about a subscription that will
      // never happen, which is why *that* one has an entrance.
      //
      // Guarded like every other read of the caller's object: this one is
      // inside a **published getter**, so a `live` getter that throws would
      // throw at whoever reads `activity` rather than being refused.
      return deriveActivity(
        safely(() => getOpts().live) ?? false,
        query.fetchStatus === 'fetching'
      );
    },
    /** The shared mapping, so both accumulators answer with the same function. */
    get state(): ReqState {
      return this.projected.state;
    },
    /**
     * State and events from one read of the value at one instant.
     *
     * Derived together rather than exposed as two getters: separate ones let a
     * consumer read a status from one generation and a list from the next, and
     * the slot mapping would have no way to tell. Reading the clock here is
     * also what arms the next expiry — the projection and the wake-up are the
     * same decision.
     */
    get projected(): { state: ReqState; nextExpiryAt: number | undefined } {
      // **Guarded, because this getter is what `state` and `diagnostics` are
      // built from** — three published members read the caller's `clock`
      // through here, and a getter that throws would throw at all three.
      const clock = runtime.clockOf();
      const now = clock?.now;
      // See {@link refusedOnServer}. `deriveState` builds the state, so this is
      // the same `error` shape the browser arm reaches through the query rather
      // than a second spelling of it.
      if (refusedOnServer !== undefined && query.status !== 'error') {
        return deriveState({ data: undefined, error: refusedOnServer }, now);
      }
      const result = deriveState(
        {
          data: query.data,
          error: rejectedWith()
        },
        now
      );
      if (result.nextExpiryAt !== undefined) clock?.wakeAt(result.nextExpiryAt);
      return result;
    },
    get diagnostics(): ReqDiagnostics {
      // Three arguments because `lastError` has three sources, in order:
      // the failure record on the value, then the *entry's* error, then an
      // incomplete answer's causes. The record is the value's and is first;
      // this comment said the reverse — that `lastError` is "the one thing that
      // is not on the value" — which was true until r11 put the failure on the
      // fold, and describing the design that was replaced is how a reader comes
      // to trust the wrong lifetime.
      //
      // The entry's error is still passed, and is not redundant: query-core
      // clears it at the start of a fetch over a valueless entry (`SEN22`)
      // while the record survives, so it is the fallback for the one failure
      // class that never reaches an attempt at all — a query function that
      // rejected before any record could be written.
      // On a server the refusal is this handle's to publish on both axes —
      // see {@link refusedOnServer}. It is the entry's error there because that
      // is the class it belongs to: a rejection that never reached an attempt.
      return deriveDiagnostics(this.state, query.data, rejectedWith() ?? refusedOnServer);
    },
    async refresh(): Promise<RefreshOutcome> {
      // **First, because a released handle can act on nothing.** `0001`'s
      // driver is that this library owns what it created, and the group it
      // names is a subscription whose lifetime belongs to something the caller
      // passes in — it outlives its consumer and starves other consumers of the
      // same object. A handle held past its own root is that shape on a
      // different object: a **write capability on a shared entry with no
      // read-back**. One line through it took a bystander from
      // settled-with-an-event to `incomplete`, ended its leg, set its
      // `lastError`, moved its `activity` to `idle` and stopped its live
      // subscription — and the bystander's slot did not move.
      //
      // So the capability is revoked when the root that created the handle is
      // released, irreversibly. `not-started` rather than `cancelled` because
      // of *when*: nothing was started by this call. `released` is the one
      // reason with no remedy, which is exactly right — the thing that would
      // act on the answer is gone.
      if (released) return { kind: 'not-started', reason: 'released' };
      // Same wiring as the verifier, and the same defect before it: the
      // provider detects the environment and put it on the context, and this
      // read never looked there — so `detectEnvironment()` decided nothing that
      // A12 is about, and every measurement of the server branch reached it by
      // passing `environment: 'server'` by hand. A12 says the server does not
      // subscribe; what was measured is that a request *told* it is on a server
      // does not subscribe, which is a different sentence.
      //
      // **And the read it was wired to was one this line could not legally
      // make.** `getContext` is legal during component initialisation and
      // inside a reaction created during one; `refresh()` is called by a
      // consumer, which on the published surface is a click handler. So the
      // first statement of the first thing a retry button calls threw
      // `lifecycle_outside_component` — measured end to end, through a real
      // provider, against svelte 5.56.8. The whole suite passed anyway, because
      // `src/tests/setup.ts` backs the context functions with a `Map` that is
      // callable everywhere. The provider is captured at construction now, and
      // this reads what was captured.
      // **One call of the caller's thunk for this call, and one read of each
      // field.** This function read `environment` twice, `scope` twice and
      // `rxNostr` twice — a field that answers differently on its two reads is
      // the shape `B4-C7` is written for, and here it would make the disposal
      // check and the target set disagree about the same client. The object
      // read here is handed to {@link requestOf} rather than read again.
      // **Named `given` rather than `opts`, because `opts` names two different
      // things in this file** — here it is the caller's object, and in
      // {@link resolveRequest} it is the request the boundary already built.
      // A check that has to tell a raw read of the caller's object from a read
      // of a value this module made cannot do it by identifier while both are
      // spelled the same, which is what `WR19` counts.
      const given = getOpts();
      const request = requestOf(given);
      const environment = request.environment ?? 'browser';
      // **Guarded, because `refresh()` rejects and a rejection is a published
      // value.** These three are read off the caller's own object, and a getter
      // that throws here rejected the promise with *their* exception — measured:
      // `code: undefined`, `name: 'Error'`, not a value of this channel at all,
      // which puts the whole `RefreshRejection` contract out of reach. Every
      // other read of the caller's object in this file goes through a guard for
      // this reason; these three were the ones left, and they were left because
      // nothing on this path is typed by the compiler.
      const readClient = readSeam(() => given.client);
      // One read of the transport as well: the disposal check and the target
      // set below are about the same client, and reading it twice is how they
      // would come to disagree about it.
      const readTransport = readSeam(() => given.rxNostr);
      // **Unreadable is a refusal on this path, and only on this path.** The
      // seams are read raw everywhere else in this file for a stated reason —
      // the client *is* the channel a refusal would be published on, so there is
      // nowhere to put one. `refresh()` is the exception: it hands the caller a
      // promise, so a refusal has somewhere to go, and it goes there named.
      //
      // **`safely` cannot say this, and using it here rejected a legitimate
      // call.** It answers `undefined` for "the read threw" *and* for "the value
      // is absent", and on a server `rxNostr` is absent by construction — so the
      // first version of this guard rejected every server `refresh()` with
      // `invalid-descriptor` instead of resolving `{ kind: 'not-started' }`,
      // which is the false rejection the ordering below exists to prevent
      // (`AE22`, measured). What this path needs is the *fact of the throw*, so
      // the read reports it.
      if (!readClient.read) {
        throw ownedByLibrary(new InvalidDescriptorError('client', 'could not be read'));
      }
      if (!readTransport.read) {
        throw ownedByLibrary(new InvalidDescriptorError('rxNostr', 'could not be read'));
      }
      const queryClient = ownedClient();
      // The same derivation the options factory runs, not a copy of its result:
      // this is the one place the two could name different entries, and when the
      // key was the caller's it silently did whenever they changed it without
      // the factory re-running. Through {@link requestOf} for the same reason
      // the environment above is: the resolution the factory makes is one this
      // path cannot repeat by reading the context again.
      const { descriptor, rejection, key, deferred } = resolveRequest(request);
      const live = descriptor?.live ?? false;

      // **First, because a plan that is not asking has no attempt to wait for
      // and no refusal to report.** It resolves rather than rejecting: nothing
      // went wrong, and a retry button wired to `refresh()` on a query that has
      // not been made yet is an ordinary thing to write. The reason says which
      // "nothing was asked" this is — `no-readable-relay` is the provider's
      // list, `server` is the side, this is the caller's own plan.
      if (deferred) return { kind: 'not-started', reason: 'deferred' };

      // A descriptor this library will not send is a failure of the call, not
      // an attempt that came back partial: nothing was tried, and a caller who
      // awaited `refresh()` inside a `try` should see it there rather than as
      // an outcome they have to remember to inspect.
      //
      // Read from this call's own resolution rather than from a variable the
      // options factory left behind. The variable was there because the factory
      // was the only place the boundary ran; now both places run it, and one
      // mechanism for one claim is the rule the rest of this file follows.
      if (rejection !== undefined) throw rejection;

      // Nothing to start. Kept apart from an empty `complete` because C12 rests
      // on the difference: an answer with nothing in it and no answer at all
      // render differently, and a caller driving a retry button needs to know
      // which one it got.
      //
      // **Above the transport, and it stood below it for a round.** A12 says a
      // request on the server is not started and reports not-asked, and the one
      // thing 0004 puts ahead of that is a descriptor the boundary refuses,
      // which is the check above. Nothing else outranks it, and the disposal
      // check below did: `isProviderDisposed` answers `true` for a client it
      // cannot read at all, a *missing* one included, through its own `catch`.
      // A provider rendering on a server has no transport — that is
      // `ServerNostrContext`, not an accident — so a request built from what
      // such a provider owns was told the connection was "terminated … no later
      // attempt will succeed", which is false of a page about to hydrate.
      // `AE22` is the witness, and the cast it needs in order to pass an absent
      // transport into this option bag is why no caller reaches it today.
      //
      // What this order gives up is the cell where both are true — a caller who
      // says `environment: 'server'` while handing over a client that really
      // was disposed. That is reachable through this option bag and through
      // nothing on the published surface, where both inputs come from one
      // provider and it has one or the other. The cell answers `'server'` now,
      // and that is what this way round is *for*: on the server nothing is
      // asked, so the state of a transport nothing was going to use decides
      // nothing. It is also what the request path already does — a server
      // descriptor plans as `defer`, the query function never runs, and no
      // disposal is consulted there either.
      if (environment === 'server') return { kind: 'not-started', reason: 'server' };

      // **The owner going away is a failure of the call, and this is the only
      // place it is published.** A provider that is destroyed revokes its
      // capability *before* it cancels attempts and *before* it disposes the
      // client, so from that instant nothing can start a request against it and
      // nothing can observe the disposal any other way — which is what lets
      // `provider-disposed` be a rejection rather than a state (`lease.ts`).
      //
      // Read off the capability rather than by asking the client, because asking
      // the client is a check-then-use: the helper this replaced answered `true`
      // only once the dependency had already thrown once, and it is deleted —
      // once the request path stopped holding a client it had no caller left.
      //
      // **The call that reaches here is one made *after* the teardown.** A
      // `refresh()` already in flight when the provider goes away is rejected by
      // step 2 of the linearisation — its attempt is abandoned *as a disposal* —
      // rather than by this line, so for a round this branch had no witness at
      // all and a mutation that took it away killed nothing (`expected: RM4 /
      // actual: (none)`, measured). `RM8` drives both now.
      //
      // **And the caller-owned client is not this event.** They were one
      // condition, so a low-level caller who disposed their own client got
      // `provider-disposed` from `refresh()` and `invalid-descriptor` from the
      // initial request — one ownership event with two classifications, which is
      // the split a reviewer measured. `callerTransport` is never revoked, so
      // this test is only ever true of a provider that took its client back; the
      // caller's half is `requestTargets` below, which refuses the seam by name.
      // A second guard written here for it had no entrance and was deleted
      // rather than witnessed: `requestTargets` is reached on this path and
      // publishes the identical refusal, so disabling the guard left `RM4`
      // green.
      if (transport.revoked) {
        throw providerDisposed(
          'nosvelte: the provider connection is terminated, so this request cannot be ' +
            'refreshed. That is a disposed provider rather than a relay that is down, and ' +
            'no later attempt will succeed.'
        );
      }

      // The scope's, not the client's: this call is about the request, and the
      // request is the one keyed under that scope. A client that has drifted has
      // not changed what this request may ask.
      //
      // **Asked of the plan rather than of the relay list**, because those are
      // two facts and the query obeys the first. A request built when there was
      // nowhere to ask is `defer`red — `enabled: false` — and stays that way
      // until its *descriptor* is evaluated again (`P19c`, `P19d`); relays
      // arriving at the transport underneath do not move it. So a `refresh()`
      // made after they arrive found targets, went on, and asked for an attempt
      // the query would never begin — which came back as a **rejection** saying
      // the request "is disabled, or nothing is holding it any more", to a
      // caller whose hook is mounted and holding it. Measured.
      //
      // `not-started` with the reason is the answer the other direction already
      // gives (`P24`): nothing was asked, and the way out is the descriptor
      // rather than this call.
      //
      // **The `kind` is true here always; the `reason` is true of the plan.**
      // `'server'` has already returned above, so a browser plan is `defer`
      // only when the request had nothing readable to ask when the descriptor
      // was last evaluated — which is what the word says.
      //
      // **Two arrangements produce that, and only one of them is stale.** A
      // request that named no relays takes the provider's readable set, so its
      // `defer` is about a scope that had nothing — the case the paragraphs
      // below are about. A request that named `relays: []` asked of nowhere on
      // purpose: its effective target set is empty by the caller's own
      // decision, no provider update can change it, and `no-readable-relay` is
      // exactly true of it rather than a beat out of date. It names a cause that has
      // since changed whenever the plan is older than the relays, and there are
      // **two** ways to get there rather than one: the client moved behind the
      // scope's back, which is the drift `C6` says a consumer cannot cause and
      // `SC6` measures; and a scope update whose descriptor has not been
      // evaluated again yet, which is the ordinary `refresh()` in the same turn
      // as the write (`P19c`, `P19d` are the delay, `P24b` the call). The
      // second is reachable and its answer is the safe one — `not-started`
      // rather than a rejection, with the next evaluation opening the request —
      // but the *reason* on it is a beat out of date. A port that keeps this
      // wording owes the same two edges; one that cannot re-derive between the
      // write and the call owes a reason of its own.
      const asked = requestTargets(transport, request.scope);
      if (planned === 'defer' || asked.length === 0) {
        return { kind: 'not-started', reason: 'no-readable-relay' };
      }

      // Single-flight, per cache entry rather than per hook — everything below
      // happens once for however many calls are waiting on it. The lane is the
      // entry for the same reason the claim's lane is: two hooks over one entry
      // is what the query library is kept for, so "the attempt for this request"
      // is a property of the key and not of whoever asked. What the two callers
      // then share is one REQ, one Promise and one outcome object; what the
      // later of them gives up is that the attempt may have started before it
      // asked. See {@link AttemptRegistry.single}.
      //
      // A lane is a cache entry, which is what makes this coalescing rather than
      // a per-hook convention: two hooks over one identity are on one lane, so
      // the second joins rather than superseding.
      const attempts = ownedAttempts();
      return await attempts.single(hashKey(key), async (mine) => {
        // The id is claimed before anything is started, and that order is the
        // contract rather than a precaution: the attempt this call waits for has
        // to have a name already when it begins, or the only question the wait
        // can ask is "is this end newer than the one that was there" — which two
        // calls answer identically. The claim is what carries the name into the
        // query function the refetch below re-runs, and claiming is also what
        // starts the lifetime the wait hangs off.
        const lifetime = attempts.lifetime(mine);

        // **A request that *failed* is re-fetched like any other.** The branch
        // that used to reset it is gone, and it went for the reason it was
        // introduced for: it was never the trigger's branch, it was
        // {@link backlogOutcome}'s. A failed entry keeps its error until a fetch
        // *succeeds*, a live query function never settles, so a re-fetched failed
        // live request carried the previous attempt's error for the whole life of
        // the new one — and the read that decided this call's outcome took that
        // standing error for its own. **That read no longer exists.** The failure
        // is stamped with the attempt that produced it and matched by id, exactly
        // as the answer is, so an error left standing on the entry is not
        // something any outcome can be attributed to any more.
        //
        // The trigger half was never the problem, and that is measured rather
        // than assumed: `SEN22`(a) drives `refetchQueries` at an entry that is
        // `status: 'error'` / `fetchStatus: 'idle'` with an observer, against the
        // resolved query-core, and the query function runs. Deleting the branch
        // was then measured the way the `forward.end` half was a round earlier —
        // the parity suite before and after, on both accumulators, 112/112 either
        // way, with `P41`, `P47` and `P48` unchanged. Deleted rather than kept:
        // the reset path drops the cache entry and puts it back by hand, and a
        // branch doing that where nothing needs it is a hazard no expectation is
        // watching.
        //
        // What went with it is the `setQueryData` put-back that stood below. Its
        // job was to hand the reset branch back the events it had just dropped,
        // and with only `joining` left it could never write anything: that
        // condition has `query.data === undefined` as a conjunct, so the value it
        // would have preserved is `undefined` by construction.
        //
        // A refetch over a fetch that has not written anything yet is not a new
        // attempt. query-core hands back the running one instead —
        // `cancelRefetch` is switched off while `data` is undefined — so the
        // claim would sit unclaimed while somebody else's attempt ran, and this
        // call would wait for an id nothing is going to stamp. `resetQueries`
        // puts the entry back to idle first, so the attempt this call named is
        // the one that runs. There is nothing to lose by resetting here: the
        // value is undefined, which is what put us in this branch — which is also
        // why C11's "keep the events already held" needs nothing of this branch.
        const joining = query.fetchStatus !== 'idle' && query.data === undefined;
        const started = joining
          ? queryClient.resetQueries({ queryKey: key, exact: true })
          : queryClient.refetchQueries({ queryKey: key, exact: true });

        // The other end of the hand-off, checked rather than assumed. A trigger
        // that comes back having opened no request — a disabled query, a key
        // with no entry — leaves the claim on its lane, and with no ceiling left
        // to reject it this call would wait forever for an attempt that never
        // began. A live attempt that *did* begin never resolves this promise,
        // and does not need to: it took the claim on its way past.
        //
        // **The message is now true of every case that reaches it, which it was
        // not.** `started` *resolves* when the query function rejects —
        // `refetchQueries` catches with `throwOnError` unset — so a query
        // function that ran and threw arrived here too, and while the claim was
        // taken inside `streamFn` an accumulator that threw before reaching it
        // was reported as "an attempt that never began". Measured, not
        // reasoned: it came back rejected with this text over an attempt that
        // had begun and failed. The claim is taken at the query function's
        // entry now, so anything that got as far as running is `begun` and this
        // branch is left with the case it names.
        // **The three ways this promise resolves with nothing begun**, counted
        // from the dependency rather than from the two that were first noticed:
        // there is no entry, the entry is disabled, or the fetch is **paused**.
        // The message named the first two as though they were all of them, so a
        // `refresh()` made while the browser was offline rejected saying the
        // request "is disabled, or nothing is holding it any more" — measured,
        // both halves false, `isDisabled()` false and one observer holding it —
        // and the ask then went out when the connection came back, under a new
        // attempt, delivering to a caller whose promise had already rejected.
        //
        // **The third way is unreachable now**, and by a decision rather than by
        // luck: this library sets `networkMode: 'always'`, so the query layer
        // does not stand between a `refresh()` and an attempt — `ACT-8` is the
        // arm. The message is back to naming the two states that remain, and
        // the pause is gone rather than described.
        void started.then(
          () => {
            if (!attempts.begun(mine)) {
              attempts.abandon(
                mine,
                'refresh() asked for an attempt that never began. The request was not in a ' +
                  'state to be re-run — it is disabled, or nothing is holding it any more.'
              );
            }
          },
          () => undefined
        );

        // Awaiting `started` is only correct for a non-live request: for a live
        // one the promise behind it is the query function's, and a live query
        // function does not settle (CONST-T12). What this waits for is the
        // *backlog*, which ends either way — so the wait is on the value rather
        // than on the call, and a healthy forward leg is left alone rather than
        // being something the Promise hangs on.
        //
        // A failed request used to be excluded here too, because it took the
        // reset branch and `resetQueries` resolves when the re-run *starts*
        // rather than when it ends. It is on the refetch path now, so there is
        // nothing to exclude: a non-live refetch settles with the attempt, which
        // is what this await is for.
        //
        // Raced, because this promise is not this attempt's: a fetch cancelled
        // to make room for a later one resolves with the later one's promise
        // (SEN16), so a call whose attempt was replaced waits for the attempt
        // that replaced it. Two `refresh()` calls no longer do that to each
        // other — they share one attempt — but anything else that observes this
        // entry still can, and then the replacement may be a live fetch whose
        // promise never settles at all.
        if (!live) {
          await Promise.race([started, untilAbandoned(lifetime)]);
        } else {
          void started;
        }
        return await backlogOutcome(queryClient, key, mine, lifetime);
      });
    }
  };
  let recoveryFrom: unknown;
  let recoveryDue: number | undefined;
  let recoveryFor = 0;
  let recoveryHint = 0;
  $effect(() => {
    const clock = runtime.clockOf();
    const resume = runtime.resumeOf();
    // Read for the subscription, not for the value: a hint is what brings a
    // pending wait forward, and a reader with nothing pending is unaffected.
    const hinted = resume?.generation ?? 0;
    if (clock === undefined || resume === undefined) return;

    const value = query.data;
    const end = value?.forward?.end;
    // **Ended, with nothing having said no.** A forward record exists only for
    // a live request, so "live" is the record being there at all; an end with
    // refusals under it is the relays' answer rather than the transport's.
    const recoverable = end?.kind === 'ended' && (value?.forward?.refusals.length ?? 0) === 0;
    if (!recoverable) {
      recoveryFrom = undefined;
      recoveryDue = undefined;
      recoveryFor = 0;
      return;
    }

    const now = clock.now;
    if (recoveryFrom !== end) {
      // **A new ending, and the count is deliberately not reset here.** It was,
      // for an afternoon, on the reasoning that "a feed that recovers and dies
      // again waits from the beginning". The reasoning describes a *recovered*
      // feed and the code could not tell one from a failed recovery: every
      // recovery that fails writes a new ending, so the count went back to zero
      // and the wait never grew past the first step — a request retrying a
      // permanently dead relay every two seconds, for ever, which is the busy
      // loop this backoff exists to be instead of.
      //
      // What resets it is the request being **healthy**: a leg with no end is
      // not recoverable, and the branch above clears everything. So consecutive
      // failures back off further and a success starts over, which is what that
      // sentence meant.
      recoveryFrom = end;
      recoveryDue =
        now +
        (RECOVERY_BACKOFF_SECONDS[Math.min(recoveryFor, RECOVERY_BACKOFF_SECONDS.length - 1)] ?? 0);
      clock.wakeAt(recoveryDue);
      return;
    }
    if (recoveryDue === undefined) return;
    // The hint's whole effect: a wait that is pending stops waiting. It cannot
    // *start* one — a hint with nothing pending is a no-op — because relying on
    // the host's events alone cannot recover from a relay-specific failure.
    if (now < recoveryDue && hinted === recoveryHint) return;
    recoveryHint = hinted;
    recoveryFor += 1;
    recoveryDue =
      now +
      (RECOVERY_BACKOFF_SECONDS[Math.min(recoveryFor, RECOVERY_BACKOFF_SECONDS.length - 1)] ?? 0);
    clock.wakeAt(recoveryDue);
    // **Through the same door a consumer's `refresh()` takes.** It was
    // `query.refetch()`, on the reasoning that a refetch is a new attempt and
    // the query layer joins overlapping ones — and a refetch opens no *flight*,
    // which is the thing `refresh()` shares. Measured: a consumer pressing
    // retry in the tick a recovery fired claimed a lane whose attempt the
    // recovery had already taken, and their call came back
    // `cancelled / consumer-released` — for a request that succeeded and a
    // consumer nobody released. `RC5` is that measurement.
    //
    // **This effect is registered after the handle literal**, which is what
    // lets it call the published method rather than a hoisted copy of its body.
    // Hoisting was tried first and re-indents every line of `refresh()`: two
    // ledger anchors went from matching once to matching twice, because the
    // indentation *is* the anchor.
    //
    // The rejection is swallowed: nobody asked for this one, so there is no
    // caller to tell, and what a consumer sees is the request's own state
    // moving.
    void handle.refresh().catch(() => undefined);
  });

  return handle;
}
