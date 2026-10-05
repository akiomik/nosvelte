/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a request's failure channel publishes, as a type a consumer can branch
 * on without `instanceof`.
 *
 * **The channel was typed `Error`, and that made `code` unreachable.** `code`
 * exists because `instanceof` cannot be trusted across a duplicate install —
 * two copies of this package in one tree, which pnpm and a monorepo both
 * produce, hand a consumer an object whose prototype is not the one their
 * `instanceof` names. But `ReqState.error` was declared `Error`, so
 * `state.error.code` did not compile (`TS2339`), and the only type-safe route to
 * `code` was `state.error instanceof ReqFailure && state.error.code` — through
 * the mechanism `code` was introduced *because* it cannot be trusted. The design
 * was circular, and it was circular in the record a port inherits rather than in
 * the spike.
 *
 * The same declaration made the deep-`readonly` promise unreachable:
 * `state.error.message = '[redacted]'` type-checked, because the `readonly`
 * re-declarations live on the classes and `Error` is what the channel said it
 * handed out.
 *
 * So the channel publishes a **structural discriminated union**. Every variant
 * carries a literal `code`, so `switch (state.error.code)` narrows with no
 * class in sight; nothing here is a class, so a port owes the *shape* rather
 * than this library's inheritance; and every member a consumer can reach —
 * including `cause` — is `readonly`.
 *
 * **Each surface takes the smallest sub-union it can.** Typing them all
 * `ReqError` would let a consumer write, and this library appear to promise,
 * combinations it never produces: `status: 'error'` with
 * `code: 'incomplete-result'` is the state whose whole point is that it is not
 * an error state. `Extract`/`Exclude` over one union is how the correspondence
 * between a state and its failure is made correct by construction.
 *
 * **A new internal cause does not get a new `code`.** The question a code
 * answers is "does the consumer do something different", so a cause with the
 * same remedy takes an existing code and one that cannot be classified takes
 * `unspecified`, which is permanent. Adding a member to any union here is a
 * breaking change: an exhaustive `switch` in a consumer stops compiling. There
 * was a second such home, `internal-failure`, and it is gone: after its four
 * meanings went where they belonged nothing produced it but a defensive arm, and
 * a code with no entrance is a member a consumer can branch on and never reach.
 */
import type { IncompleteCauses } from './eventset.js';
import { boundedMessage } from './normalize.js';
import type { FailureSource } from './own.js';
import { hardenOwned, sealClass } from './owned.js';

/**
 * Everything this channel can hand a consumer, anywhere.
 *
 * **Every member is written out, and that is deliberate rather than untidy.**
 * Nine variant interfaces and two bases were exported; none of them is a name a
 * consumer needs, and a published name is a SemVer surface that cannot be taken
 * back — `Extract<ReqError, { code: 'unsupported-filter' }>` writes down any
 * part of the union without one, and
 * `Pick<ReqError, 'name' | 'message' | 'stack' | 'cause'>` writes down the
 * common part. But a published type that *names* an unpublished one hands a
 * consumer something they cannot spell, so a shared base would have to be
 * published to be referenced. Repetition is what "self-contained" costs.
 *
 * **And nothing here intersects `Error`.** It did, so that the union would read
 * as "an `Error` with more on it" — and an intersection keeps `Error`'s
 * *mutable* `message` beside the `readonly` one, which TypeScript resolves in
 * favour of the assignment: `state.error.message = '…'` compiled again, which is
 * the failure `LK18` exists for. What a consumer holds is an `Error` at run
 * time; what the type promises is the shape.
 *
 * `cause` is narrowed from `Error`'s `unknown`: what is published there is
 * another value of this channel or nothing, never the graph of whatever was
 * thrown.
 *
 * **The captured members correlate `source` with `code`**, so a consumer who has
 * narrowed on one has narrowed on the other, and a value that disagrees with
 * itself cannot be written down. The run-time half is that `code` is a total
 * function of `source`, computed in one place.
 */
export type ReqError =
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'incomplete-result';
      readonly incompleteCauses: IncompleteCauses;
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'invalid-descriptor';
      readonly field: string;
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'unsupported-filter';
      readonly field: string;
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'relay-not-in-scope';
      /** The target, by the name the provider's transport gives it. */
      readonly url: string;
      /** Configured on the provider but not readable, rather than absent. */
      readonly configured: boolean;
    }
  /**
   * The transport could not name a relay this request asks of: it threw, or
   * answered something that is not one relay URL, or answered differently for
   * a question it had answered before. Not a descriptor fault — no field
   * changes it — so not `invalid-descriptor`: the remedy is pinning or
   * upgrading rx-nostr or this library, or reporting what it said. `field` is
   * always `relays`, the field whose value was being named.
   */
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'transport-incompatible';
      readonly field: 'relays';
    }
  /*
   * **`attempt-abandoned` was the eleventh member and is gone.**
   *
   * It existed to be the value `refresh()` **rejected** with when the thing
   * waiting for the attempt went away — a consumer navigating off a slow feed,
   * an attempt replaced by a later one on the same request. That is not a failure
   * of anything, and putting it on the rejection channel made
   * `onclick={() => handle.refresh()}` — the line every application writes for a
   * retry button — produce an unhandled promise rejection for a case where
   * nothing went wrong.
   *
   * It is a `RefreshOutcome` now: `{ kind: 'cancelled', reason:
   * 'consumer-released' }`. The class that carries the abort reason still exists,
   * because an `AbortSignal` needs a reason and this library owns the one it
   * gives; what is gone is the code's membership of *this* channel, which is what
   * made it publishable. A member of a closed union that no path can produce is a
   * promise a consumer can branch on and never see taken, which is the reason
   * `internal-failure` was removed and the same reason applies here.
   */
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'accumulator-contract';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'provider-disposed';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'missing-provider';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly thrownName: string;
      readonly truncated: boolean;
      readonly source: 'descriptor';
      readonly code: 'descriptor-unreadable';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly thrownName: string;
      readonly truncated: boolean;
      readonly source: 'relay';
      readonly code: 'relay-failed';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly thrownName: string;
      readonly truncated: boolean;
      readonly source: 'unspecified';
      readonly code: 'unspecified';
    };

/** What a value copied at a door carries. Internal: `Extract` writes it down. */
export type CapturedReqError = Extract<
  ReqError,
  { readonly code: 'descriptor-unreadable' | 'relay-failed' | 'unspecified' }
>;

/**
 * Every code this channel can publish.
 *
 * **Derived from the variants rather than declared beside them.** It was its own
 * literal union, and `ReqErrorCode` could gain a tenth member — with the value
 * list and the door map updated to match — while no variant carried it: the
 * three-way check passed and `ReqError['code']` did not have it. There is one
 * source of truth now, and it is the union.
 *
 * **Ten, and the union is closed for v1 in the direction that matters.** A
 * member *removed* is what breaks a consumer's exhaustive `switch`, and that is
 * a major. A member *added* is a code an existing `switch` has no arm for, which
 * is why one arrives only with the remedy that justifies it — the last was
 * `missing-provider`, which separates "this request has no provider at all"
 * from the partial-descriptor refusal it used to be published as, and a
 * consumer's remedy for it is to wrap the tree in a provider. `REQ_ERROR_CODES`
 * is the count: nothing here restates it.
 */
export type ReqErrorCode = ReqError['code'];

/**
 * What each **surface** can carry, derived from the paths that reach it.
 *
 * **A syntactic complement is not a projection.** `status: 'error'` was declared
 * `Exclude<ReqError, IncompleteReqError>` — "everything except the partial
 * answer" — and one alias stood for three different contracts. Measured, the
 * sets are not the same and none of them is that one: `refresh()` **rejects**
 * with a descriptor refusal and **resolves** `{ kind: 'error' }` for an
 * accumulator's, `attempt-abandoned` reaches the rejection and nothing else, and
 * a leg end carries exactly one code. A consumer's `switch` over a wider union
 * has arms this library never takes, and a new code added to the channel flows
 * into every surface without anyone deciding that it should.
 *
 * So each surface is written out, and `0005` carries the reachability matrix
 * that each of these is read off. Two of them are equal today (`ReqLastError`
 * and `ReqOutletError`); they are still written separately, because equality is
 * a fact about the current paths and not about the contracts.
 */
export type ReqStateError = Extract<
  ReqError,
  {
    readonly code:
      | 'invalid-descriptor'
      | 'unsupported-filter'
      | 'relay-not-in-scope'
      | 'transport-incompatible'
      | 'descriptor-unreadable'
      | 'missing-provider'
      | 'accumulator-contract'
      | 'unspecified';
  }
>;

/** What `status: 'incomplete'` carries: the partial answer's own error. */
export type IncompleteError = Extract<ReqError, { readonly code: 'incomplete-result' }>;

/**
 * What `RefreshOutcome`'s `{ kind: 'error' }` carries.
 *
 * Narrower than `ReqStateError` because a descriptor refusal never gets here:
 * `refresh()` throws it, so the caller sees a rejected promise rather than an
 * outcome. That difference is the one a consumer most needs, and the types are
 * where it is said.
 */
export type RefreshOutcomeError = Extract<
  ReqError,
  { readonly code: 'accumulator-contract' | 'unspecified' }
>;

/**
 * What `refresh()` **rejects** with.
 *
 * A promise's rejection has no place in a TypeScript signature, so this is the
 * contract written down: these seven codes and nothing else. The reads
 * `refresh()` takes of the caller's own seams are guarded for that reason — an
 * unguarded one rejected with an uncoded value and put this set's own promise
 * out of reach.
 */
export type RefreshRejection = Extract<
  ReqError,
  {
    readonly code:
      | 'invalid-descriptor'
      | 'unsupported-filter'
      | 'relay-not-in-scope'
      | 'transport-incompatible'
      | 'descriptor-unreadable'
      | 'missing-provider'
      | 'provider-disposed';
  }
>;

/** What the `error` slot is handed: the state's error, whichever state it is. */
export type ReqOutletError = ReqStateError | IncompleteError;

/**
 * What `diagnostics.lastError` carries.
 *
 * The same set as the slot today, and written separately because it gets there
 * another way: the value's own failure record, the entry's error, or the partial
 * answer's error when nothing threw.
 */
export type ReqLastError = ReqStateError | IncompleteError;

/**
 * What a forward leg's end carries: **one code**.
 *
 * It was two. `internal-failure` was in this union because the machine names the
 * reason itself when every relay in scope stops — and `endForward` puts every
 * reason through the relay door, which re-derives anything that did not come
 * from a relay. Measured, on all ten codes: what reaches `legEnded.error` is
 * `relay-failed`, always. A union member no path can produce is a promise a
 * consumer can branch on and never see taken.
 */
export type RelayLegError = Extract<ReqError, { readonly code: 'relay-failed' }>;

/**
 * The codes, as a value, for the two things that iterate them: the door map
 * below and the check that the union and this list cannot drift.
 *
 * **Not published.** A consumer branches on `state.error.code`, which the types
 * already give them; a list of every code the channel has anywhere is a wider
 * thing than any surface hands out.
 */
export const REQ_ERROR_CODES = [
  'incomplete-result',
  'invalid-descriptor',
  'unsupported-filter',
  'accumulator-contract',
  'descriptor-unreadable',
  'relay-failed',
  'unspecified',
  'provider-disposed',
  'missing-provider',
  'relay-not-in-scope',
  'transport-incompatible'
] as const satisfies readonly ReqErrorCode[];

// **Both directions, and the second one was written backwards once.**
// `satisfies` above gives list ⊆ type. This gives type ⊆ list: a code carried by
// a variant and left out of the array is a `ReqErrorCode` the array's member
// type cannot hold, so it fails here. And since `ReqErrorCode` is now derived
// from `ReqError['code']`, a variant added without a code — or a code invented
// without a variant — cannot get past the pair.
const _everyCodeIsListed: (typeof REQ_ERROR_CODES)[number] = null as unknown as ReqErrorCode;
void _everyCodeIsListed;

/**
 * Which door a value of this channel belongs to, for every code it can carry.
 *
 * Declared here because it is a fact about the union rather than about the
 * boundary that applies it: `capture` uses it to decide whether a value that
 * arrives somewhere it did not come from has to be re-derived. Not published —
 * it is how this library normalises, not something a consumer branches on.
 */
export const DOOR_OF: Readonly<Record<ReqErrorCode, FailureSource>> = Object.freeze({
  'invalid-descriptor': 'descriptor',
  'unsupported-filter': 'descriptor',
  'relay-not-in-scope': 'descriptor',
  'transport-incompatible': 'descriptor',
  'descriptor-unreadable': 'descriptor',
  'relay-failed': 'relay',
  'incomplete-result': 'unspecified',
  'accumulator-contract': 'unspecified',
  'provider-disposed': 'unspecified',
  // **`unspecified`, because that is where this library's own value arrives.**
  // The refusal is thrown out of the query function, whose `catch` captures at
  // the `unspecified` door — so the row states a fact about the code's producer,
  // which is what every other row here states.
  //
  // **What the row decides is the other two doors, and only those.** `capture`
  // re-derives when the arriving door disagrees *and is not* `unspecified`
  // (`own.ts`), so at the `unspecified` door every value of ours is handed
  // through whatever this row says: the mapping is inert on the path the code
  // actually travels. With `'descriptor'` here, a library-minted
  // `MissingProviderError` thrown into the **descriptor** boundary was handed
  // through unchanged and published "no provider found" on a request that has a
  // provider. `PO8` measures that pair; `PO12` measures all ten rows, because
  // the first repair closed this row and left the other nine — an adversarial
  // pass then moved `provider-disposed` to `descriptor` and the whole suite
  // stayed green.
  //
  // **The reachable form is narrower than the mechanism, and saying so is part
  // of the row.** A descriptor *getter* cannot deliver one: `requestOf` reads
  // every published field through `read()`, which reports the field name and
  // publishes `invalid-descriptor` before `capture` sees anything — measured.
  // The entrance that remains is a caller-owned `RelayScope` whose `id` getter
  // throws, inside `resolveRequest`'s `try`, which is a standalone seam v1 does
  // not publish. So this row is a rule kept where it is cheap, not a defect
  // closed on a live path.
  'missing-provider': 'unspecified',
  unspecified: 'unspecified'
});

/** The door a captured value arrived at, re-exported so one import carries the channel. */
export type { FailureSource };

/**
 * A request asked of a relay the provider cannot read from.
 *
 * **Refused before the wire, and that is the whole reason it is a refusal
 * rather than a silent narrowing.** The alternative — intersect the request's
 * targets with the readable set and send what is left — makes a typo into a
 * quieter version of the same request: the REQ goes to the other three relays,
 * the answer looks complete, and nothing says a relay the caller named was
 * never asked. The one shape where an empty target set is *not* an error is the
 * one the caller wrote empty on purpose (`relays: []`), which is a state rather
 * than a refusal.
 *
 * **On the request channel, and not on `RelayConfigurationError`'s.** The two
 * refusals answer different questions and reach a consumer in different places:
 * a refused relay *list* is the provider's and arrives on the context, a refused
 * relay *target* is this request's and arrives on `state.error` and on
 * `refresh()`'s rejection. So this carries a `ReqErrorCode` — the eleventh when
 * it was added, and
 * it is here because its remedy is neither `invalid-descriptor`'s (the value is
 * a perfectly good relay URL) nor the provider's: ask of a relay this provider
 * has, or add this one to the provider.
 *
 * **A shape fault in `relays` is *not* this.** A member that is not a string,
 * not a relay URL, or a name the transport would rename a second time is
 * refused as `invalid-descriptor` on the field, with everything else a caller
 * writes wrongly — one remedy, one code. **Nor is a transport that cannot name
 * the member at all** — it threw, answered something that is not one name, or
 * contradicted an answer it gave before: that is `transport-incompatible`,
 * whose remedy is rx-nostr or this library rather than the descriptor or the
 * provider's list. What separates the three is what has to change.
 *
 * `configured` is the distinction a consumer acts on within that: a relay they
 * configured write-only is a capability to change, a relay they never configured
 * is a list to add to.
 */
export class RelayNotInScopeError extends Error {
  /** See {@link UnsupportedFilterError}'s re-declaration for why these are here. */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: ReqError | undefined;

  readonly code = 'relay-not-in-scope' as const;
  /** What the caller asked of, by the name the provider's transport gives it. */
  readonly url: string;
  /** Was it configured on the provider at all, but not readable? */
  readonly configured: boolean;

  constructor(url: string, configured: boolean, readable: readonly string[]) {
    super(
      // Bounded, as every other value this library renders into a message is:
      // the name comes from a string the caller wrote.
      `nosvelte: this request asks of ${boundedMessage(url).text}, which ` +
        (configured
          ? `this provider has configured as write-only. A REQ cannot be sent to a relay ` +
            `that is not readable, so the request is refused rather than sent to the rest.`
          : `is not in this provider's relay list. The request is refused rather than sent ` +
            `to the relays that are, so that a misspelled or unconfigured target is not a ` +
            `quietly narrower request.`) +
        ` The relays this provider can read from are ` +
        (readable.length === 0 ? 'none' : boundedMessage(readable.join(', ')).text) +
        `. Ask of one of those, or add this relay to the provider.`
    );
    (this as { name: string }).name = 'RelayNotInScopeError';
    hardenOwned(this);
    this.url = url;
    this.configured = configured;
    Object.freeze(this);
  }
}
sealClass(RelayNotInScopeError);

/**
 * The request values of code `transport-incompatible`, by provenance.
 *
 * **The code alone cannot say which channel a value is on**: the provider's
 * `TransportIncompatibleError` carries the same literal and is a relay
 * configuration refusal, published on `configurationError`. A request's
 * refusal is the class below, and only a value its constructor registered here
 * is the request's.
 */
export const REQUEST_TRANSPORT_REFUSALS = new WeakSet<object>();

/**
 * A request asked of a relay its transport could not name (`transport-
 * incompatible`). Built where a request resolves its relays, from the
 * transport's own refusal, which this carries as bounded words rather than as
 * itself (`unnameableRelay`).
 */
export class RequestTransportIncompatibleError extends Error {
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: ReqError | undefined;

  readonly code = 'transport-incompatible' as const;
  readonly field = 'relays' as const;

  constructor(said: string) {
    super(`nosvelte: this request names ${said}`);
    (this as { name: string }).name = 'RequestTransportIncompatibleError';
    hardenOwned(this);
    REQUEST_TRANSPORT_REFUSALS.add(this);
    Object.freeze(this);
  }
}
sealClass(RequestTransportIncompatibleError);
