/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Taking ownership of a value that arrived from outside, by not keeping it.
 *
 * **The boundary used to keep the caller's object and defend it; it takes a
 * snapshot now and refers to nothing of theirs.** The history is worth the
 * paragraph, because the second design is what the first one's defects argue
 * for. A hostile value — a `Proxy` that refuses `preventExtensions`, an object
 * with no prototype, an `Error` whose `message` getter throws — reaches this
 * library through every channel a consumer can throw on: the descriptor
 * boundary's `catch`, the query function's `catch` around an accumulator, the
 * transport's leg-end reason, and `noteFailure`, which a port calls directly.
 * Keeping their object meant defending it, and each round of defence widened
 * the surface: `instanceof` had to be guarded, then the rendering, then the
 * freeze, then the freeze's effect on the identity test, then the `cause`
 * chain, then `AggregateError.errors` — and the last of those shipped a bare
 * `Array.isArray` that a **revoked `Proxy` on `cause`** made throw, so the
 * failure was not recorded at all.
 *
 * That is the third round in which the repair opened the next hole, and the
 * shape is not accidental: **keeping a foreign object means promising things
 * about a graph somebody else owns.** Even bounded and fully guarded, the
 * promise is only "the first N nodes are best-effort frozen"; past the bound the
 * consumer still holds the caller's objects, a freeze that fails half way cannot
 * be rolled back, and identity was never uniform anyway — a cross-realm `Error`
 * and a lying `Proxy` both lose it.
 *
 * So the failure channel publishes a value **this library constructed**:
 * {@link ReqFailure}. What it promises is unconditional, and each half is
 * measured rather than argued (`PO7`):
 *
 * - **capturing never throws**, whatever was thrown, and never touches the
 *   value it was handed — the caller's `Error`, its `cause` graph and its own
 *   properties come out of the boundary unfrozen and unchanged;
 * - **what is published refers to nothing of theirs**, so a caller mutating
 *   their graph afterwards changes nothing a reader can see;
 * - **the bounds are deterministic**: a `cause` depth and a length applied to
 *   the message and to the name, with `truncated` saying whether any of them
 *   cut. **Three bounds, not four** — this sentence promised a node count as
 *   well and there has never been one, which is the class of defect these
 *   records are about;
 * - **capturing twice is capturing once**, because a snapshot handed back is
 *   returned unchanged. That is about the *snapshot*: the same thrown value
 *   captured at two doors is two failures, and each says the door it arrived
 *   at.
 *
 * **And the registry is minted by the factory, not by the class.** `ReqFailure`
 * is published, so a constructor that registered would hand a consumer the
 * authority to say "this is the library's" — measured: a consumer-built failure
 * carrying their live graph was published unchanged. Registration happens after
 * the copying, on the value rather than on the class (`PO8`).
 *
 * **What stays a public `Error` class**: the ones this library throws itself —
 * `MissingProviderError`, `MissingRandomnessError`, the relay-configuration
 * family, `IncompleteResultError`. Those are ours by construction, carry a
 * stable `code`, and a consumer branches on them. The rule is one sentence: an
 * object on the failure channel is one **this library made**, never one it was
 * handed.
 *
 * **And the extension point, so the next round does not re-open this.** If a
 * caller callback is ever published (an accumulator, a verifier), the way to let
 * a consumer keep their own error type is an explicit `mapError(error):
 * ReqFailure` seam — not an implicit capture of whatever graph they threw.
 */

import { AccumulatorContractError } from './attempt.js';
import type { RelayMessage } from './normalize.js';
import { boundedMessage, describeValue } from './normalize.js';
import { hardenOwned, isOwnedByLibrary, ownedByLibrary, sealClass, sealOwned } from './owned.js';
import type {
  CapturedReqError,
  RefreshOutcomeError,
  RelayLegError,
  ReqError,
  ReqStateError
} from './reqerror.js';
import { DOOR_OF, REQ_ERROR_CODES, REQUEST_TRANSPORT_REFUSALS } from './reqerror.js';

/**
 * Is this one of *this channel's* values?
 *
 * **Private, and its precondition is what makes it sound.** It is only ever
 * asked of a value {@link isOwnedByLibrary} has already accepted, so the shape
 * is guaranteed by the construction site and the only open question is which
 * code it carries — `RelayConfigurationError` and the two construction-time
 * errors are this library's too, and theirs are not `ReqErrorCode`s.
 *
 * There used to be a published `isReqError` doing this for arbitrary `unknown`,
 * and a guard and a union are two hand-written descriptions of one shape: it
 * accepted `{ code: 'unsupported-filter' }` with no `field`, then `stack: 42`,
 * then an `incompleteCauses` of strings that are not causes. What a consumer
 * needs is the discriminant on a value this library already typed, so the guard
 * is gone from the surface and this is what is left.
 */
function isChannelValue(value: object): value is ReqError {
  const code: unknown = safely(() => (value as { code?: unknown }).code);
  if (typeof code !== 'string' || !(REQ_ERROR_CODES as readonly string[]).includes(code)) {
    return false;
  }
  // **A shared literal is not a shared channel.** The provider's relay
  // configuration refusal is `transport-incompatible` too; only the request's
  // own refusal, registered where it was built, is a request value.
  return code !== 'transport-incompatible' || REQUEST_TRANSPORT_REFUSALS.has(value);
}

/**
 * Read something that may refuse to be read.
 *
 * The guard the rest of this library's hostile-value handling is written on —
 * `instanceof` invokes `getPrototypeOf`, `String()` invokes `toString`,
 * `Object.freeze` invokes `preventExtensions`, and a `Proxy` can make any of
 * them throw. Used here and in `useStreamedReq.svelte.ts`, whose docblock above
 * `requestOf` records which reads of the caller's object are guarded and why.
 */
export const safely = <T>(read: () => T): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

/**
 * What a thrown value says about itself, as a string this library can carry.
 *
 * **The other half of the same boundary, and it was written three times in
 * `scope.svelte.ts` without it.** A refusal that has to *quote* what a seam
 * threw asks two questions of a hostile value — is it an `Error`, and what is
 * its `message` — and both are reads a `Proxy` can make throw. Measured: a
 * relay input whose `url` getter throws such a proxy came back to the consumer
 * as `TypeError: 'getPrototypeOf' on proxy` instead of the
 * `RelayConfigurationError` this surface publishes.
 *
 * `describe` is the caller's own renderer for the not-an-Error case, because
 * what reads well differs by boundary — a relay list says what it saw, a
 * descriptor says what it was given.
 */
export function saidBy(thrown: unknown, describe: (value: unknown) => string): string {
  return saidWithBounds(thrown, describe).text;
}

/**
 * The same read, with the fact of the cut kept.
 *
 * {@link saidBy} is the projection for the callers that are building a sentence;
 * this is what {@link capture} needs, because `ReqFailure.truncated` is a claim
 * about whether anything was cut and it cannot be re-derived from the string
 * afterwards.
 */
export function saidWithBounds(
  thrown: unknown,
  describe: (value: unknown) => string
): RelayMessage {
  // **The message first and the identity test second**, which is the opposite of
  // how these three sites were written. A `Proxy` around a real `Error` can
  // refuse `getPrototypeOf` while answering `.message` perfectly well, and what
  // a refusal wants to quote is the message — asking "is it an Error" first
  // throws away a readable answer because an unreadable question came first.
  const message = safely(() => (thrown as { message?: unknown }).message);
  // **Bounded, because the caller of the value chooses its length.** The
  // message-first path returned whatever was on `.message`, and
  // `scope.svelte.ts` interpolates that into a published, stored
  // `RelayConfigurationError`: a relay input whose getter threw an `Error` of
  // 100 000 characters produced a refusal of 100 439, while the same payload
  // thrown as a plain object came out at 646 because that path goes through
  // `describeValue`'s cap. One bound, declared once, applied to both.
  if (typeof message === 'string') return boundedMessage(message);
  const rendered = safely(() => describe(thrown));
  return boundedMessage(rendered ?? 'a value that cannot be rendered');
}

/**
 * Where a failure came from, as a word the consumer can branch on.
 *
 * One per capture site rather than one per thrown value: what the library knows
 * for certain is which of its own boundaries the value arrived at, and that is
 * the thing a consumer can act on. `descriptor` means the request could not be
 * built from what they passed; `accumulator` means the fold they supplied threw;
 * `transport` means the leg's producer gave out; `writer` is a port calling the
 * failure writer with something of its own.
 */
/**
 * Where a failure came from, in the vocabulary of the **production** surface.
 *
 * **Re-derived from what a consumer can actually meet, not from where this
 * spike happens to catch.** The first version published
 * `'descriptor' | 'accumulator' | 'transport' | 'writer'` — and two of those are
 * not entrances a shipped consumer has: `accumulator` is a seam 0004 says is not
 * published, and `writer` is a place inside the library where a value is
 * *stored*. A published union is a long-lived API whose members are hard to
 * remove, so it names the two doors a consumer can be standing at and one honest
 * answer for everything else:
 *
 * - `descriptor` — the request could not be built from what they passed;
 * - `relay` — a relay or the transport gave out;
 * - `unspecified` — **the complement of the two above, not a third entrance.**
 *   The failure reached this library somewhere it cannot attribute: a seam this
 *   surface does not publish, or a port calling the failure writer with a value
 *   of its own. Naming it `internal` would call a dependency's failure a library
 *   bug; naming it `writer` would publish an implementation position. This says
 *   the one thing that is true — that the attribution is not available — and a
 *   consumer branches to their generic failure path on it.
 *
 * **It never erases an attribution**: a value that already says `relay` keeps it
 * when it passes a door that cannot attribute, because "I do not know" is not
 * news that overwrites "I do".
 *
 * **The union is closed for v1.** Adding a member is a breaking change for a
 * consumer writing an exhaustive `switch`, so a source that appears before the
 * next major maps to `unspecified` rather than growing the union; a public
 * callback — the `mapError` seam the header names — arrives in a major, with its
 * semantic member and its contract at the same time. That is what a literal
 * union costs, and it is paid deliberately: the alternative is an open type that
 * promises a consumer nothing.
 */
export type FailureSource = 'descriptor' | 'relay' | 'unspecified';

/**
 * The `code` a consumer branches on, as a literal union.
 *
 * Published as a union rather than as `string`: the record says a consumer
 * branches on the literal, and `readonly code: string` promises them nothing —
 * measured in the emitted declarations, which carried exactly that.
 */
export type FailureCode = 'descriptor-unreadable' | 'relay-failed' | 'unspecified';

const CODE_OF: Readonly<Record<FailureSource, FailureCode>> = Object.freeze({
  descriptor: 'descriptor-unreadable',
  relay: 'relay-failed',
  unspecified: 'unspecified'
});

/**
 * How deep a `cause` chain is copied.
 *
 * Deterministic, because `truncated` is published and a bound that depends on
 * the shape of the caller's graph is a bound a consumer cannot reason about.
 * Three is the depth at which the chains this library has seen — a wrapped
 * transport error under a wrapped parse error — are whole.
 *
 * **Depth, and only depth.** The docblock used to promise a node count as well,
 * and there was none: a bound that is written down and not implemented is the
 * class of defect these records are about.
 */
const MAX_CAUSE_DEPTH = 3;

/**
 * What this library publishes when something thrown from outside has to be
 * kept.
 *
 * **A snapshot, not the thrown value.** It refers to nothing the caller owns:
 * their `Error`, its `cause` graph and its own properties are read once, copied
 * into strings and numbers, and never touched again — so mutating their graph
 * afterwards changes nothing a reader of this can see, and nothing of theirs is
 * frozen by us.
 *
 * It is an `Error` subclass rather than a plain record because the failure
 * channel is a `catch` in the consumer's code: `state.error` stays `instanceof
 * Error`, and the library's own classes on the same channel
 * (`IncompleteResultError`, the relay-configuration family) keep their identity
 * beside it.
 */
export class ReqFailure extends Error {
  /**
   * The three members `Error` gives this class, re-declared as `readonly`.
   *
   * **`B5-C8` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and these three were not**: they are inherited,
   * where they are mutable, so `state.error.message = '[redacted]'` compiled —
   * legal-looking code the run time refuses, which is the exact failure the
   * sentence exists to prevent. `declare` makes this type-only: the run time is
   * unchanged and the modality reaches the emitted `.d.ts`, which is where
   * `LK17` reads it, over the four classes still exported as values rather than this one. (A
   * merged `interface` says the same thing and is what
   * `@typescript-eslint/no-unsafe-declaration-merging` exists to stop.)
   */
  declare readonly message: string;
  /**
   * A literal rather than `string`, because the record makes it a discriminant:
   * a consumer who does not want `instanceof` reads `code` first and `name`
   * second, and `string` says nothing they can branch on.
   */
  declare readonly name: 'ReqFailure';
  declare readonly stack?: string;

  /** What the thrown value called itself, bounded. `` `a thrown ${typeof}` `` if it said nothing. */
  readonly thrownName: string;
  /** Which door it arrived at, in the vocabulary of {@link FailureSource}. */
  readonly source: FailureSource;
  /** A stable literal per source, for a consumer that branches without `instanceof`. */
  readonly code: FailureCode;
  /** Whether any bound cut: the message, the name, or the depth of the `cause` chain. */
  readonly truncated: boolean;
  /** The next link of the thrown value's `cause` chain, copied under the same rules. */
  override readonly cause: CapturedReqError | undefined;

  /**
   * **It mints nothing, and the class is no longer published at all.**
   *
   * This constructor used to call the ownership registrar, and that was a door
   * in the wall: `ReqFailure` was on the published entry, so a consumer could
   * `new ReqFailure({ cause: theirGraph })`, hand it to a filter getter, and
   * have `capture` recognise it as ours and publish it unchanged — their live
   * object on `cause` and any `message`, `truncated` or `source` they liked.
   * Measured against the packed build: `published === forged` and
   * `published.cause === foreign`, mutations and all.
   *
   * Membership is minted by {@link snapshot} alone, after the copying. And what
   * a consumer names on the failure channel is the **shape**
   * (`CapturedReqError`), not this class, so there is no public constructor for
   * a value it could never mint: the name went with the authority.
   */
  constructor(
    fields: Readonly<{
      thrownName: string;
      message: string;
      source: FailureSource;
      truncated: boolean;
      cause: CapturedReqError | undefined;
    }>
  ) {
    super(fields.message);
    // Cast because the `declare readonly` fields above make these `readonly` for a
    // consumer; the constructor is where this library sets them.
    (this as { name: string }).name = 'ReqFailure';
    this.thrownName = fields.thrownName;
    this.source = fields.source;
    // **No `?? 'unspecified'` here, and its absence is the point.** The
    // coalesce that stood here made the map look total while hiding the one way
    // it can stop being: a `FailureSource` added without a `CODE_OF` entry would
    // have published `source: <the new one>` with `code: 'unspecified'` — a pair
    // the published type says cannot exist, minted by the one expression that
    // decides it. `CODE_OF` is `Record<FailureSource, FailureCode>`, so a
    // missing entry is a compile error instead.
    this.code = CODE_OF[fields.source];
    this.truncated = fields.truncated;
    this.cause = fields.cause;
    // **No freeze here, and that is the repair.** Freezing in the constructor
    // put it *before* the registrar closed `stack`, so the close failed on a
    // frozen object and the setter stayed live — `Object.isFrozen` said `true`
    // the whole time. The order belongs to {@link sealOwned}, which the factory
    // below calls; a `ReqFailure` a consumer constructs is theirs, unfrozen,
    // and is captured like any other foreign value when it reaches a boundary.
  }
}
sealClass(ReqFailure);

/**
 * The provider this request was made under has been disposed.
 *
 * **This was `internal-failure`, and `internal-failure` was four things.** Six
 * bare `new Error(...)` used to be registered as this library's and published
 * with no `code` at all — which is why the channel's type had to be `Error`.
 * Giving them one code was the first repair and the wrong one: a code exists to
 * tell a consumer to do something different, and a disposed provider ("make a
 * new one; this handle will never work again"), a relay that went away ("retry
 * when it comes back"), a missing verifier ("fix your wiring") and a teardown
 * note ("nothing — you are not meant to see this") are four answers. They are
 * separated now, and this is the one that is genuinely its own: not retryable on
 * the handle a consumer is holding, and not a relay's fault.
 *
 * Exported for the arms, which name each class this library makes; the entry
 * does not publish it, and {@link providerDisposed} is how this library builds
 * one.
 */
export class ProviderDisposedError extends Error {
  /**
   * The four members `Error` gives this class, re-declared. See any sibling for
   * why: inherited members are where the deep-`readonly` promise was false.
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: ReqError | undefined;

  readonly code = 'provider-disposed' as const;

  constructor(message: string) {
    super(message);
    (this as { name: string }).name = 'ProviderDisposedError';
    hardenOwned(this);
    Object.freeze(this);
  }
}
sealClass(ProviderDisposedError);

/**
 * Build one, minted, sealed and typed as what the channel publishes.
 *
 * The construction sites call this rather than the constructor, because minting
 * is the library saying *it* made this object on this occasion — see
 * {@link ownedByLibrary}.
 */
export function providerDisposed(
  message: string
): Extract<ReqError, { readonly code: 'provider-disposed' }> {
  return ownedByLibrary(new ProviderDisposedError(message));
}

/**
 * A relay failure this library names itself.
 *
 * **The machine synthesises two of these** — a connection that ended before the
 * backlog did, and a live request whose every relay stopped — and they were
 * `internal-failure` values that the relay door then re-derived into
 * `relay-failed` anyway. Building them at the door they belong to says the same
 * thing without the round trip, and without a code on the value that no reader
 * ever sees.
 */
export function relayFailure(message: string): RelayLegError {
  const said = boundedMessage(message);
  return snapshot({
    thrownName: 'RelayFailure',
    message: said.text,
    source: 'relay',
    truncated: said.truncated,
    cause: undefined
  });
}

/**
 * The one place a `ReqFailure` becomes this library's.
 *
 * Everything it is handed has been derived here — the bounds applied, the source
 * chosen by the call site, the cause copied — so registering it is a statement
 * about *this* object rather than about the class.
 */
function snapshot<S extends FailureSource>(fields: {
  thrownName: string;
  message: string;
  source: S;
  truncated: boolean;
  cause: CapturedReqError | undefined;
}): Extract<CapturedReqError, { readonly source: S }> {
  // **One cast, and it is the correlation between `source` and `code`.** The
  // published type pairs them, so a consumer who narrowed on one has narrowed on
  // the other; the class cannot carry the pairing, because its `source` and its
  // `code` are each the whole union. What decides the pair at run time is
  // {@link CODE_OF}, a total map from `source` applied in the constructor —
  // there is one expression in this module that can make them disagree, and
  // `PO7` reads the pair off a published value.
  return sealOwned(new ReqFailure(fields)) as unknown as Extract<
    CapturedReqError,
    { readonly source: S }
  >;
}

/** What the value called itself, read the way everything else here is read. */
function nameOf(thrown: unknown): string {
  const named = safely(() => (thrown as { name?: unknown }).name);
  if (typeof named === 'string' && named.length > 0) return named;
  // **One branch, not two.** This read `kind === undefined ? 'a thrown value' :
  // …`, and the record described the two answers as different cases — but
  // `typeof` has no proxy trap and cannot throw: measured against a revoked
  // proxy (`'function'`) and against one whose `get` and `getPrototypeOf` throw
  // (`'object'`). `'a thrown value'` was a published string nothing could
  // produce. The coalesce is what keeps the function total without claiming a
  // second behaviour that no input reaches.
  return `a thrown ${safely(() => typeof thrown) ?? 'value'}`;
}

/**
 * Copy what was thrown, and keep nothing of it.
 *
 * **Total by construction rather than by guarding one operation at a time.**
 * Every read of the caller's value goes through {@link safely}, including the
 * one that looks safest: the previous design walked `errors` with a bare
 * `Array.isArray`, and a revoked `Proxy` on `cause` made *that* throw — out of
 * the boundary whose whole promise is that it does not.
 *
 * Applying it to a snapshot returns the snapshot, so the two applications the
 * published path makes are one.
 */
export function capture(thrown: unknown, source: FailureSource): ReqError {
  // **A value this library made passes through**, which is the other half of
  // the rule: `UnsupportedFilterError`, `IncompleteResultError` and the
  // relay-configuration family are ours by construction, carry a stable `code`,
  // and a consumer branches on them — copying those into a snapshot would take
  // away the discriminant `C16` promises. Membership is a `WeakSet`, so a
  // `Proxy` wrapping one of ours is *not* ours: what a consumer would hold is
  // the wrapper, and neither is a `ReqFailure` a consumer constructed, because
  // the registrar is not in its constructor.
  //
  // **And ours is not enough on its own: it has to be one of *this channel's*
  // values.** `RelayConfigurationError` and the two construction-time errors are
  // this library's too, and their `code` is not a `ReqErrorCode` — publishing
  // one here would put a value on the channel that the channel's own type does
  // not describe. Those are copied like anything else; what a consumer loses is
  // a class they do not branch on here, and what they gain is that
  // `state.error.code` is total.
  if (
    typeof thrown === 'object' &&
    thrown !== null &&
    isOwnedByLibrary(thrown) &&
    isChannelValue(thrown)
  ) {
    // **A snapshot re-captured at a *different* door is re-derived**, because
    // `source` is a claim about where this failure arrived and passing one
    // through would make it a claim about where the object was first seen. That
    // is the memo defect this boundary already removed once, and a consumer
    // holds these objects: given a `ReqFailure` from a relay failure, throwing
    // it back from a filter getter published `code: 'relay-failed'` for a
    // request that never reached a relay (measured). At the same door it is the
    // same failure, so the object is returned — which is what keeps
    // `state.error === diagnostics.lastError` one value.
    //
    // **And the rule was written for one class while nine could reach it.**
    // `already` was `thrown.source`, which only a snapshot carries, so the eight
    // other channel classes passed through at *any* door: measured, an
    // `UnsupportedFilterError` a consumer holds on `state.error` and throws back
    // from a relay-side seam came out with `code: 'unsupported-filter'` on a
    // relay failure. The door a value belongs to is a total function of its
    // `code` — {@link DOOR_OF} — so the rule is the same rule and its population
    // is every value this boundary can hand through.
    const already = DOOR_OF[thrown.code];
    // **`unspecified` never erases an attribution**, because it does not mean
    // "it came in here" — it means *this door cannot say where it came from*.
    // The failure writer is such a door: a port calls it with a value that
    // already knows it came from a relay, and re-deriving would replace
    // `relay-failed` with `unspecified` and call that an improvement.
    if (already !== source && source !== 'unspecified') {
      return copyOf(thrown, source, MAX_CAUSE_DEPTH);
    }
    // Frozen on the way out, because the failure channel is shared: two hooks
    // refused for the same reason read one object, and a leg end is republished
    // on every read of `diagnostics`. Ours to freeze, so the guard here is for
    // symmetry rather than for a value that might refuse.
    return safely(() => Object.freeze(thrown)) ?? thrown;
  }
  // **No memo, and its absence is the repair.** A module-level `WeakMap` keyed
  // on the thrown object stood here so that two captures of one failure gave one
  // object — and it made `source` a fact about where an object was *first* seen
  // rather than where this failure arrived: `capture(e, 'descriptor')` then
  // `capture(e, 'relay')` returned the first snapshot, `source: 'descriptor'`,
  // for a failure that came from a relay. A caller who re-throws one Error from
  // two attempts got the older message, too.
  //
  // What that memo was for is `state.error === diagnostics.lastError`, and that
  // does not need it: the failure is captured once where it happens, and the
  // record carries the same object to both surfaces. Occurrence identity is the
  // record's, not the thrown object's — which is what `C15` says about answers.
  return copyOf(thrown, source, MAX_CAUSE_DEPTH);
}

/**
 * What a failure **record** carries, which is narrower than what a state does.
 *
 * The record feeds `RefreshOutcome`'s `{ kind: 'error' }`, and a descriptor
 * refusal never gets here: `resolveRequest` throws it above the query's `try`,
 * so `refresh()` **rejects** with it and the outcome channel never sees one
 * (measured). A total function into the narrower type is what makes that a
 * property of the code rather than an observation about it.
 */
export function recordedFailure(value: ReqError): RefreshOutcomeError {
  // Exhaustive for {@link terminalFailure}'s reason: a condition list plus a
  // cast is a mapping the compiler is not checking, and the compiler is the only
  // thing that notices a tenth code.
  switch (value.code) {
    case 'accumulator-contract':
    case 'unspecified':
      return value;
    // `relay-not-in-scope` sits with the descriptor refusals: it is made at the
    // same boundary, above the query's `try`, so it reaches `refresh()` as a
    // rejection and never as an outcome.
    case 'invalid-descriptor':
    case 'unsupported-filter':
    case 'relay-not-in-scope':
    case 'transport-incompatible':
    case 'descriptor-unreadable':
    case 'missing-provider':
    case 'incomplete-result':
    case 'provider-disposed':
      // **`provider-disposed` is a rejection, not a record.** Nothing writes one
      // here — the lease refuses before a request can begin — and the arm above
      // is what keeps that true rather than assumed. `missing-provider` is the
      // same shape one step earlier: the request refuses before it begins, so
      // `refresh()` rejects with it and no outcome carries one.
      return copyOf(value, 'unspecified', MAX_CAUSE_DEPTH);
    case 'relay-failed':
      return accumulatorBroke(value);
    default: {
      const unreached: never = value;
      return unreached;
    }
  }
}

/**
 * A value the accumulator seam produced that this channel forbids there.
 *
 * **`A11-P4` says a conforming accumulator does not re-publish a leg end's
 * reason as a terminal query failure, and this is the boundary that makes the
 * violation legible.** A `relay-failed` value arriving at a *terminal* door can
 * only have come back through the accumulator: the relay door is the only place
 * that mints one, and the only way one returns is if somebody threw it. So it is
 * not "a failure this library cannot attribute" — it is attributable, to the
 * seam it came out of.
 *
 * It was `unspecified` for a round, which is a consumer remedy ("read the
 * message; the library cannot say") for a case the library can say everything
 * about. The relay's own words survive on the `cause`.
 */
function accumulatorBroke(
  value: ReqError
): Extract<ReqError, { readonly code: 'accumulator-contract' }> {
  const said = boundedMessage(
    `an accumulator re-published a relay leg's end as a terminal failure: ${value.message}`
  );
  // **The relay's own value underneath, rather than only its words.** `A11-P4`
  // forbids `relay-failed` *at this door*; it does not make what the relay said
  // unreadable, and a consumer looking at a broken accumulator is exactly the
  // one who needs it. `cause` is where this channel already publishes another of
  // its own values, and `value` is one.
  return ownedByLibrary(new AccumulatorContractError(said.text, value));
}

/**
 * What a relay leg's end carries.
 *
 * **A door with a narrower published type needs a total function into it.**
 * `capture` hands one of ours back with the classification it already has, and a
 * `UnsupportedFilterError` thrown from inside a relay subscription is ours — so
 * the pass-through can put a descriptor refusal on a surface whose type says
 * "the relay's failure, or this library stopping the leg". Anything else is
 * re-derived at this door, which is the same rule `capture` applies to a
 * snapshot arriving somewhere it did not come from.
 */
export function captureFromRelay(reason: unknown): RelayLegError {
  const captured = capture(reason, 'relay');
  // **One code comes out of here, and the branch that said otherwise was dead.**
  // It read `code === 'relay-failed' || code === 'internal-failure'`, and the
  // second half could never be true: a value carrying `internal-failure` has
  // `DOOR_OF` `'unspecified'`, which disagrees with this door, so `capture`
  // re-derives it before this line sees it. Measured on all ten codes — every
  // one comes back `relay-failed`. `LegEnd.error` is typed for exactly that.
  return captured.code === 'relay-failed' ? captured : copyOf(reason, 'relay', MAX_CAUSE_DEPTH);
}

/**
 * What a request's own failure is: everything except the partial answer.
 *
 * The partial-answer error is synthesised from the state and is never thrown, so
 * this narrowing is an invariant rather than a coercion. It is written as a
 * total function anyway, because a value that did arrive here would otherwise
 * need a cast — and a cast is where a type stops being checked.
 *
 * **The fallback is `unspecified` and it used to be `internal-failure`.** This
 * arm is the only thing that ever produced that code, and a code with no
 * concrete entrance is a member of a closed union that a consumer can branch on
 * and never reach. `unspecified` already means "this library cannot attribute
 * it", which is exactly what an incomplete answer arriving on a terminal surface
 * is.
 */
export function terminalFailure(value: ReqError): ReqStateError {
  // **Exhaustive, and it used to be a cast.** It rewrote `incomplete-result` and
  // returned everything else as `value as ReqStateError` — and `ReqStateError`
  // excludes two more codes than that. Measured by a reviewer:
  // `terminalFailure(relayFailure(…)).code` came back `relay-failed`, and an
  // `AttemptAbandonedError` came back `attempt-abandoned`, both wearing a type
  // that says those codes cannot be there. A cast is where a type stops being
  // checked; a `switch` whose `default` assigns to `never` is where a code added
  // to the channel and not to this mapping stops compiling.
  switch (value.code) {
    // `relay-not-in-scope` is on `ReqStateError` for `invalid-descriptor`'s
    // reason: the request was refused at the descriptor boundary, so the
    // refusal is what the state holds and there is no partial answer under it.
    case 'invalid-descriptor':
    case 'unsupported-filter':
    case 'relay-not-in-scope':
    case 'transport-incompatible':
    case 'descriptor-unreadable':
    case 'missing-provider':
    case 'accumulator-contract':
    case 'unspecified':
      return value;
    // **The three a request's own failure cannot be, re-derived rather than
    // re-labelled.** A partial answer has its own status and its own slot; an
    // abandoned attempt is a fact about a call, not about a state; and a
    // relay's failure belongs to the leg it ended — `A11` says a conforming
    // accumulator does not re-publish one as a terminal failure, and this is
    // what keeps the alias true if one does.
    case 'incomplete-result':
    case 'provider-disposed':
      // A disposed provider is the owner going away, not a request failing:
      // `refresh()` rejects with it and no state carries it.
      return copyOf(value, 'unspecified', MAX_CAUSE_DEPTH);
    // **Named rather than anonymised.** A relay's failure reaching a terminal
    // door came back through the accumulator seam, which is a violation of
    // `A11-P4` and a thing this library can attribute — see
    // {@link accumulatorBroke}.
    case 'relay-failed':
      return accumulatorBroke(value);
    default: {
      const unreached: never = value;
      return unreached;
    }
  }
}

function copyOf<S extends FailureSource>(
  thrown: unknown,
  source: S,
  depth: number
): Extract<CapturedReqError, { readonly source: S }> {
  const said = saidWithBounds(thrown, describeValue);
  const named = boundedMessage(nameOf(thrown));
  const nextCause = safely(() => (thrown as { cause?: unknown }).cause);
  const hasCause = nextCause !== undefined && nextCause !== null;
  // **The depth is checked before the read is used, and the read is guarded
  // whether or not it is used.** A chain deeper than the bound is not an error:
  // it is `truncated`, which is published, and the nodes past the bound are
  // simply not copied — this library never held them.
  const cause = hasCause && depth > 1 ? copyOf(nextCause, source, depth - 1) : undefined;
  // **A value that was already bounded here keeps the fact of it.** Re-capturing
  // a snapshot at a different door re-derives every field from the object in
  // hand, and the object in hand is *already cut* — so a four-deep chain
  // captured at `relay` and thrown back at `descriptor` came out
  // `truncated: false` while still missing the node past the bound. Measured.
  // The re-derivation cannot see what is no longer there; the flag is the only
  // thing that can carry it.
  const wasTruncated =
    isOwnedByLibrary(thrown) && safely(() => (thrown as ReqFailure).truncated) === true;
  return snapshot({
    thrownName: named.text,
    message: said.text,
    source,
    // **Every bound this snapshot applied, in one flag.** It used to be the
    // chain's depth alone: the message came back from a helper that dropped the
    // fact of its own cut, so a 10 000-character message was published at 207
    // with `truncated: false`. The name is bounded too, and its cut is the same
    // claim.
    truncated:
      said.truncated ||
      named.truncated ||
      wasTruncated ||
      (hasCause && depth <= 1) ||
      cause?.truncated === true,
    cause
  });
}
