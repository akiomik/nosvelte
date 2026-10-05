/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Which attempt, and who gets to say.
 *
 * `refresh()` promises to resolve on the outcome of the attempt *it* started.
 * The value has carried a stamp for that since 0003, and the stamp was a number
 * a module-level counter produced, which `refresh()` compared with `>`. Ordering
 * cannot express "mine": two calls on one key read the same number before either
 * attempt runs, so either can be answered by the other's outcome. Equality can —
 * but only if the caller knows its own id *before* the attempt it asked for
 * begins, which is what this module is for.
 *
 * So an id is claimed on one side of the hand-off and picked up on the other,
 * and both sides name the same lane. **A lane is a request**, which here is the
 * cache entry: one entry is one request however many hooks observe it, and the query function that runs for a key belongs
 * to whichever observer of that key set the options last, whoever asked for the
 * refetch — measured at the resolved version, `SEN11`. A slot held beside one hook
 * would hand its id to an attempt another hook's function started, and the
 * caller would wait for an id nothing ever stamps.
 *
 * **This used to cite `SEN9`, and it was true of the sentinel added with this
 * module.** That one was given an id the relay-cap measurement in the rx-nostr
 * sentinels already had; the collision was found, the query-core one was
 * renumbered to `SEN11`, and `CAT14` was written so that a repeat fails. The
 * rename reached 0005 and did not reach here, so the id left behind now points
 * at a measurement about subscription caps, which says nothing about whose
 * options a refetch runs.
 *
 * The lane is also what makes an attempt shareable, which is the other half of
 * the same question: two calls asking one request the same thing at the same
 * moment get one attempt between them. See
 * {@link AttemptRegistry.single}. That is why one lane never has two claims
 * outstanding, and why nothing here has to decide which of two claimants owns
 * the lane.
 *
 * The registry is the provider's. Per hook is not enough for the same reason the
 * lane is not: two hooks sharing an entry is what the query library is here for,
 * and two minters would hand that one entry overlapping ids. Module-global is
 * what the counter was, and that is one per process — shared between
 * server-rendered requests and between tests, which is the shape C6 exists to
 * remove.
 *
 * The registry owns the other half of the same fact: how long an attempt can
 * still answer. A waiter needs both — the id to match, and the moment matching
 * becomes pointless — and holding the second anywhere else means guessing at it
 * with a clock. See {@link AttemptAbandonedError}.
 */

import { hardenOwned, ownedByLibrary } from './owned.js';
import type { ReqError } from './reqerror.js';

/**
 * Which attempt produced something.
 *
 * Opaque on purpose, and **read two ways rather than one**: every reader
 * outside this module asks equality, and the module that mints an id owns the
 * one comparison there is (see {@link isOlderAttempt}). What that comparison
 * answers is a *lane rewind* — "was this id minted before the one the value is
 * on, by the same registry" — and not "did this attempt run earlier": nothing
 * guarantees the attempt that claimed the later id is the one that runs later,
 * which is why no general order is published.
 *
 * **This paragraph said "every read of it is an equality" for several rounds
 * after the comparator existed**, twelve lines above the comparator's own
 * definition, and 0003 said it too. A reviewer named the pair; the split is 0002
 * A6's and this is the copy that has to follow it.
 *
 * **The brand does not enforce that, and this used to say it did** — "the brand
 * is what stops the next reader reaching for `>` again". It stops nothing. A
 * branded string is a subtype of `string`, so under this project's own
 * `tsconfig` (tsc 5.9.3, `strict`) `a > b`, `a < b` and `[a, b].sort()` over two
 * minted ids all compile, exit 0. And what they compute is wrong rather than
 * absent: an id ends in a decimal counter — `r<token>a1`, `r<token>a2`, … — so
 * `'…a10' > '…a9'` is `false` and a default sort reads `…a1 …a10 …a11 …a12 …a2 …` — among the first dozen, every id
 * from `a2` to `a9` compares as greater than each of `a10`, `a11` and `a12`,
 * which is the reverse of the order they were minted in. **A count stood here
 * and its denominator was wrong**: it gave the ordered pairs among twelve ids as
 * 144, which is twelve squared and counts each id against itself. The rule above
 * is what produces the disagreement, so there is nothing left to recompute — and
 * 0002 A6 retracted the same figure in the paragraph that carries this residue,
 * which is where this docblock should have been re-read from. A reader
 * reaching for `>` gets a quiet wrong answer rather than a compile error, which
 * is worse than the counter this replaced: that one at least ordered correctly.
 *
 * What holds the property is a discipline rather than a guarantee, and the
 * discipline is not "no order anywhere": it is **one order reader, and an
 * authorized set of call sites**. `WR17` is the falsifier — a relational
 * operator over an attempt-ish pair in any module but this one, or a call of
 * {@link isOlderAttempt} outside the two in `eventset.ts` (the rewind guard in
 * the fold, and the failure writer). The wider form — "no relational operator
 * anywhere" — was written here and in 0003 and was already false when it was
 * written. Carried as residue in 0002 A6 rather than as a property of the type.
 *
 * `symbol` is the only type that would refuse it: `>` over two symbols is
 * TS2469, measured, where an object type carrying a `unique symbol` brand and a
 * class instance both compile `>` clean — so the obvious cheaper fix is not one.
 * The change is small — two source lines, the mint below and the interpolation
 * into the wire `reqIdBase` in `stream.ts` (which `symbol` also refuses, TS2731,
 * so that line becomes `String(id)`), plus two catalogue rows and no tests.
 *
 * **The price recorded here was a server-rendered handoff, and it does not
 * exist.** It read: a `symbol` crosses neither `structuredClone` nor a JSON
 * dehydration — measured, the first throws `DataCloneError` and the second drops
 * the property silently — and this id rides on a cache value, which is what a
 * handoff would carry. The measurement is true and the conclusion was not: under
 * A12 a server render fills no entry, and no cache value can cross a realm from
 * this library at all — nothing here dehydrates, persists or structured-clones,
 * and the published entry hands out neither the `QueryClient` nor the context.
 * An outside reviewer measured the render and the paths; `0003` carries the same
 * withdrawal for the cache key.
 *
 * **So the decision is re-opened rather than restated, and it is not two
 * lines.** A reviewer recommends the `symbol`, and what it owes before it can be
 * taken is written here so that the next attempt starts from the obligations
 * rather than from the sentence that was false: who owns the before-and-after
 * judgement inside one registry; that symbols minted by different registries are
 * given no order at all; an explicit function from the stamp to the wire
 * subscription id, since interpolation is what `symbol` refuses; the 64-character
 * budget recomputed against whatever that function produces; the existing guards
 * over stale chunks and stale failures re-derived against a stamp that cannot be
 * compared by `<`; a type witness that `>` is refused rather than a runtime one;
 * **how provenance rides on the value**, which is the hard one — the paragraph
 * below says it in its own words, *provenance has to be on the value, because
 * the readers that compare ids are pure functions of the cached value and cannot
 * ask a registry anything*, and a `symbol` carries identity and nothing else;
 * and **the records that describe the current stamp, re-derived with it** —
 * `B-η-C5` names the format, the 96-bit token and the absence of any order
 * between registries, and those are contract text rather than implementation.
 * An outside reviewer found the first two of these missing from this list, and
 * struck a ninth that had been on it: "runtime identity kept separate from an
 * identity a future transfer would need" was the withdrawn price wearing a new
 * name, and it is a condition for a port that changes A12 rather than one this
 * decision owes. `AttemptId` is not on the published entry, so this is an internal
 * decision — but `MissingRandomnessError` is published, and removing it is a
 * different decision that this one does not license.
 *
 * **Unique beyond the registry too, and this paragraph used to say the
 * opposite.** It read "two providers will both mint the same first id … not a
 * hole to be plugged with randomness", on the argument that an id is only ever
 * compared against one written on a cache value and a cache value belongs to
 * one provider's client (C6). The argument still holds and the conclusion did
 * not survive `isOlderAttempt`: a comparison that reads `a<n>` as a number
 * answers *something* for two ids from different registries, and answering is
 * the defect. So the prefix is drawn once per registry from the platform's
 * randomness, and ids from two registries have no order at all — the comparison
 * returns `false` rather than a guess.
 *
 * What is still true is the scope of the *order*: it exists within a registry
 * and nowhere else.
 */
export type AttemptId = string & { readonly __attemptId: unique symbol };

/**
 * Whether one attempt was minted before another, **by the same registry**.
 *
 * **This module is the only reader of an id's order, and this is the only
 * function that reads it.** Everywhere else — every consumer, and every part of
 * this library that is not the registry — an id is opaque and the only question
 * asked of it is equality: "is this the attempt I started?". 0002 A6 used to say
 * that of *every* reader, and this function is the exception that makes the
 * rule statable: the owner of the ids owns their order, and nobody else reads a
 * sequence out of the format.
 *
 * **And the question is narrower than "which ran first".** Two attempts on
 * different lanes may run in any order and this is not asked about them; what
 * it answers is whether a chunk may move a lane's value *backwards*. Its two
 * call sites are both that question: the rewind guard in the fold, and the
 * failure writer, which was found publishing a superseded attempt's Error over
 * the current generation's.
 *
 * **The id is opaque and its order is not**, and the difference is the whole of
 * this function: the value's fold has to refuse a *rewind* — a late signal from
 * a superseded producer naming an attempt older than the one the value is on —
 * and it cannot ask the registry, because it is a pure function of the value.
 * So the module that mints the ids is the one that says how they compare.
 *
 * **The first version compared `a<n>` and could not see whose `a<n>` it was.**
 * Every registry starts at zero, so a second provider's genuine first attempt is
 * `a1` — and against a value on `a2` it was read as *older* and dropped, which
 * is the very thing the guard exists to not do. A malformed id was the only
 * "unknown" the arm measured, and malformed is not the same equivalence class as
 * *legitimate, from another owner*: the second is the one that happens.
 *
 * So an id carries its registry now, and two ids from different registries have
 * **no order** — this answers `false`, which is the fail-open direction. A wrong
 * `true` drops a signal from an attempt that is genuinely current; a wrong
 * `false` lets a producer that should not be writing write, which is what the
 * value's other guards are for.
 */
export const isOlderAttempt = (candidate: AttemptId, current: AttemptId): boolean => {
  const one = ATTEMPT_ID.exec(candidate);
  const two = ATTEMPT_ID.exec(current);
  if (one === null || two === null) return false;
  if (one[1] !== two[1]) return false;
  return Number(one[2]) < Number(two[2]);
};

/** `<registry>a<n>`, which is what {@link createAttemptRegistry} mints. */
const ATTEMPT_ID = /^(r[0-9a-z]+)a(\d+)$/;

/**
 * Which registry an id came from, as a prefix on the id itself.
 *
 * **Provenance has to be on the value**, because the readers that compare ids
 * are pure functions of the cached value and cannot ask a registry anything.
 *
 * **A counter alone was not provenance**, and the first version of this was one:
 * `registries` started at zero in every *module instance*, so two realms — the
 * server render and the browser that hydrates it, or a copy of this package that
 * a bundler did not dedupe — both
 * minted `r1a1`, and the comparison read one owner's first attempt as older
 * than the other's second. That is the same defect the registry prefix was
 * introduced to repair, one level up: a name that is unique among the things
 * *this instance* made is not unique among the things that exist.
 *
 * So the token is drawn once per registry from the platform's randomness, and
 * the counter is kept only to keep an id readable on the wire — the attempt id
 * is composed into the subscription id (`stream.ts`), and
 * `req-3f9c1d2a4b6e8f0a1c2d3e4f-b:0` is still something a person can follow
 * through a log.
 *
 * **The width is 96 bits, and the number is a decision rather than a spelling.**
 * The first version kept ten hex characters of a UUID — **40 bits** — which a
 * reviewer priced: a birthday collision is ~0.45% at 100 000 registries and
 * ~36.5% at a million, and two registries that share an origin are exactly the
 * pair `isOlderAttempt` will order, so one owner's live attempt can be dropped
 * as the other's stale one. Nothing in the contract said "a few registries",
 * and a bound nobody wrote is a bound nobody has.
 *
 * 96 bits rather than the whole UUID because the id has a second constraint:
 * NIP-01 caps a subscription id at 64 characters and this rides inside one
 * (`${reqIdBase}-${attemptId}-b:<n>`). **The library's share is arithmetic, not
 * a constant**, and stating it as a constant was wrong for a round: it is
 * `25 + digits(this registry's counter) + digits(the dependency's leg counter)`
 * — the `-` that joins the caller's base, `r`, the token, `a`, the counter,
 * `-b`, `:`, and the dependency's number. **That number is `0` for every
 * request this library makes**, since the backward leg is a oneshot req and the
 * counter is its emission index — so the term it contributes is `digits(0)`,
 * which is 1. A port that re-emits owes the term properly.
 *
 * At 19 characters of token and a three-digit counter that is **29**, so a
 * 32-character base sits at **61** of the 64. In hex the token would be 24
 * characters and the same arrangement is **66** — over the cap, which is what a
 * reviewer found and `EK6` now reads, with the counter driven past one digit
 * first. (The pair used to read 30 and 66, which cannot both be right: the two
 * tokens differ by five characters, not four.) A port that mints longer bases,
 * or lets the counter run past six digits, owes the arithmetic again.
 *
 * **What is contracted is collision resistance, not uniqueness.** Two
 * independently drawn tokens can be equal; at 96 bits the probability is under
 * 2^-46 for a million registries, and this record says so rather than implying
 * a guarantee the generator cannot make. Making it *exact* would take an issuer
 * — a generation handed across the hydration boundary — which is a design this
 * library does not have and a port may.
 *
 * **There are two fallbacks and then a refusal, and the missing third is the
 * decision.** `getRandomValues` is what a browser and Node both have;
 * `randomUUID` is the next choice for a runtime that has one and not the other;
 * and a runtime with neither gets {@link MissingRandomnessError} at provider
 * construction rather than a token. Silently dropping to a short
 * `Math.random()` spelling was half of the reviewer's finding —
 * `${Math.random()}` truncated to ten characters is a biased token that starts
 * with `0` — and a composition of three draws into the same character width was
 * the other half, and is deleted: it is not cryptographic, and the cost is
 * **not** secrecy (an attempt id is not a secret and a subscription id is
 * visible to every relay) but that two realms whose PRNG starts from the same
 * seed draw the *same* token, which is the boundary this whole value exists
 * for. A fallback that keeps the width and loses the property is the failure
 * this record is about, so the value fails closed instead. `E26` is the arm,
 * and `0002` carries the trade for a port that would rather ship a weak token
 * than refuse to start.
 */
/**
 * There is no source of randomness this library can name an owner with.
 *
 * Thrown where the registry is built — at provider construction — rather than
 * at the first request, so a runtime that cannot support the guarantee says so
 * before anything depends on it.
 *
 * **Published, and carrying a code, for `MissingProviderError`'s reason**: a
 * consumer who has to recognise it is one this surface owes a name, and a
 * duplicate install of this package defeats `instanceof` while a string
 * comparison survives it.
 */
export class MissingRandomnessError extends Error {
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
   * Re-declared for its siblings' reason, and narrowed to what this class can
   * carry: it never sets a `cause`, so the published type says so rather than
   * leaving `Error`'s mutable `unknown` reachable.
   */
  declare readonly cause?: undefined;

  readonly code = 'missing-randomness' as const;

  constructor() {
    super(
      'nosvelte: no cryptographic randomness is available, so an attempt id cannot carry ' +
        'the origin that makes it distinguishable from another realm’s. Provide a ' +
        '`crypto.getRandomValues` or `crypto.randomUUID` polyfill, or hand an issuer token ' +
        'across the hydration boundary.'
    );
    (this as { name: string }).name = 'MissingRandomnessError';
    hardenOwned(this);
    Object.freeze(this);
  }
}

const HEX = (byte: number): string => byte.toString(16).padStart(2, '0');

/**
 * Ninety-six bits, written in the shortest alphabet an id may use.
 *
 * **Base 36 rather than hex, because the characters are the budget.** 96 bits
 * is 24 hex characters and 19 of these, and the five saved are five the caller
 * and the attempt counter get to spend inside NIP-01's 64 (`EK6`). The
 * alphabet is what `ATTEMPT_ID` already accepts, and the counter that follows
 * is decimal, so the split between them stays unambiguous.
 */
const base36 = (hex: string): string => BigInt(`0x${hex}`).toString(36).padStart(19, '0');

const originToken = (): string => {
  const random = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (random !== undefined) return base36([...random(new Uint8Array(12))].map(HEX).join(''));
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) {
    // **The two fixed nibbles come out first, and that is what holds this
    // branch at 96.** A v4 UUID's 13th hex character is always `4` and its 17th
    // is one of four values, so the first 24 characters *of the raw UUID* carry
    // **90** bits rather than 96 — measured over 200 draws, and the sentence
    // above this function said "the same width" while this branch took that
    // slice and was six bits short of it. Removing both nibbles first leaves 30
    // free characters, of which 24 are taken: every nibble in the token is
    // random, so the width is **96** and the sentence above is true again. The
    // records read 90 for a round after this line was repaired — they were
    // describing the slice this code no longer takes. `E27` pins which
    // characters come out, against a known UUID.
    const hex = uuid.replaceAll('-', '');
    return base36(`${hex.slice(0, 12)}${hex.slice(13, 16)}${hex.slice(17)}`.slice(0, 24));
  }
  // **No third fallback, and its deletion is the decision.** A composition of
  // three `Math.random()` draws stood here: 96 characters' worth of width, and
  // not 96 bits of entropy — they come from one PRNG whose state and seed are
  // the host's, which is exactly the realm boundary this token exists for. Two
  // realms with the same seed draw the same token, so the fallback failed at
  // precisely the job the token has. A reviewer refused it as a silent
  // weakening, and they are right: keeping a broken fallback because no
  // supported runtime reaches it is keeping a wrong answer for a question
  // nobody asks yet.
  //
  // So this fails closed, at construction, before anything is named. A runtime
  // with neither `getRandomValues` nor `randomUUID` is one this library cannot
  // give provenance on, and the honest answer is to say so — the alternative a
  // port has, when a product requirement demands such a runtime, is an
  // **issuer**: a generation handed in across the hydration boundary, which is
  // the same design exact identity would need anyway.
  throw ownedByLibrary(new MissingRandomnessError());
};

/**
 * A wait that ended because its attempt did, with no outcome to report.
 *
 * There used to be a timer for this — ten seconds, after which `refresh()`
 * rejected on the theory that an attempt still running by then had ceased to
 * exist. It could not tell the two apart: a request whose own `settleTimeoutMs`
 * is thirty seconds is healthy at ten, and a background tab whose timers are
 * throttled is healthy at any number. What actually bounds the wait is the
 * attempt, which either produces an outcome or stops being able to, and this is
 * how "stops being able to" reaches whoever is waiting.
 *
 * **`name` was the platform's — `AbortError` — and is this class's now.** The
 * reason it borrowed the platform's word was that a consumer met this value in
 * a `catch`, and one already branching on `err.name === 'AbortError'` for
 * `fetch()` should not need a second vocabulary. A consumer does not meet it
 * any more: a lifetime ending is a `RefreshOutcome.cancelled`, so this is an
 * abort *reason* the wait reads a `code` off and nothing publishes. A borrowed
 * name that no reader can see is a claim with no audience, and the ledger said
 * so first — the entry that changed it killed four arms, then none.
 */
export class AttemptAbandonedError extends Error {
  /**
   * The four members `Error` gives this class, re-declared.
   *
   * **`B5-C8` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and inherited members are where that was
   * false**: `message`, `name`, `stack` and `cause` arrive from `Error`, where
   * they are mutable, so `err.message = '[redacted]'` compiled against the
   * emitted `.d.ts` — legal-looking code the run time refuses. `cause` is
   * narrowed as well as closed: what this channel publishes there is another of
   * its own values or nothing, never the graph of whatever was thrown.
   * `declare` makes all of it type-only, and `LK17` reads the emitted result.
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: ReqError | undefined;

  /**
   * The literal a consumer branches on when `instanceof` cannot be trusted.
   *
   * **Added because the records said every value this library owns carries
   * one, and five classes did not.** This one also has a `name` that is not
   * its class — `AbortError`, which is what the platform calls a cancelled
   * operation — so the `code` is the only stable discriminant it has.
   */
  readonly code = 'attempt-abandoned' as const;

  constructor(reason: string) {
    super(`nosvelte: ${reason}`);
    this.name = 'AttemptAbandonedError';
    this.code = 'attempt-abandoned';
    hardenOwned(this);
    Object.freeze(this);
  }
}

/**
 * The accumulator returned, and left the engine with no attempt to report.
 *
 * Here rather than in the accumulator module because it is the *attempt
 * boundary's* error and not the seam's: what it reports is that an invocation
 * of the query function reached its return having produced no *ending* for its
 * attempt — no backlog end on the value, no failure of its own — while nothing
 * tore that invocation down. `StreamAccumulator` is a type that cannot require
 * any of that, which is why the engine checks rather than assumes, and why the
 * check belongs beside the ids it is checking.
 *
 * **The second half of that sentence used to read "and no stream of the
 * engine's that has unwound", and it was wrong.** A stream that simply finished
 * unwinds exactly as a torn-down one does, so the predicate was true for the
 * ordinary case and this error was withheld from the accumulator that most
 * needs it — one that drives its stream and folds with something of its own.
 * See the boundary in the engine, which now asks the invocation's own
 * `AbortController`.
 *
 * **The first half used to read "no leg on the value, no end, no failure", and
 * that was wrong too.** A leg is stamped by the *first chunk* of an attempt, so
 * an accumulator that folded one chunk with the reducer it was handed and
 * returned was read as having left an attempt to report while leaving no ending
 * at all — the query succeeded over a value carrying no outcome, and the request
 * showed a spinner it could never leave. A chunk having arrived is not an
 * attempt having ended; the boundary reads the two slots the wait reads.
 *
 * **It is a failure of the attempt, not a rejection of the call**, and that is
 * the correction r14 needed. The claim used to be abandoned here, which made
 * `refresh()` reject with an abort and made a first mount report `success` over
 * an empty value — a spinner over a request that had stopped. C11 divides on
 * whether an attempt *ran*, and entry into the query function is where 0002 says
 * an attempt starts: so an invocation that ran and produced nothing is an
 * attempt that went wrong, which is an outcome. Rejecting instead put the case
 * on C11's other side and left the public surface saying the request was still
 * loading.
 *
 * `name` is its own rather than `AbortError`: nothing was aborted, and a
 * consumer branching on the abort name must not swallow this.
 */
export class AccumulatorContractError extends Error {
  /**
   * The four members `Error` gives this class, re-declared.
   *
   * **`B5-C8` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and inherited members are where that was
   * false**: `message`, `name`, `stack` and `cause` arrive from `Error`, where
   * they are mutable, so `err.message = '[redacted]'` compiled against the
   * emitted `.d.ts` — legal-looking code the run time refuses. `cause` is
   * narrowed as well as closed: what this channel publishes there is another of
   * its own values or nothing, never the graph of whatever was thrown.
   * `declare` makes all of it type-only, and `LK17` reads the emitted result.
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: ReqError | undefined;

  /**
   * The literal a consumer branches on when `instanceof` cannot be trusted.
   *
   * **Added because the records said every value this library owns carries
   * one, and five classes did not.** This one also has a `name` that is not
   * its class — `AbortError`, which is what the platform calls a cancelled
   * operation — so the `code` is the only stable discriminant it has.
   */
  readonly code = 'accumulator-contract' as const;

  /**
   * **The cause is a parameter because this object is frozen before it is
   * returned.** `sealOwned`'s order is close, mint, freeze, and there is no
   * fourth step where a caller attaches something — so a value that belongs
   * underneath this one arrives here or not at all. What goes there is another
   * value of this channel: when the seam re-published a relay leg's end, the
   * relay's own snapshot is kept, which is how a consumer reads what the relay
   * said without this library publishing `relay-failed` at a terminal door.
   */
  constructor(reason: string, cause?: ReqError) {
    super(`nosvelte: ${reason}`);
    this.name = 'AccumulatorContractError';
    this.code = 'accumulator-contract';
    if (cause !== undefined) (this as { cause?: ReqError }).cause = cause;
    hardenOwned(this);
    Object.freeze(this);
  }
}

/**
 * Settles when the attempt does, so that nothing a caller awaits outlives it.
 *
 * An abort cannot interrupt an `await` on somebody else's promise, and there is
 * one to await before the wait proper: the trigger that starts the attempt. That promise is not bounded by this attempt — measured, and it is the
 * dependency's design rather than an accident: query-core makes a silently
 * cancelled fetch *piggyback on the promise of the fetch that replaced it*, so a
 * superseded `refresh()` awaiting its own trigger is waiting for somebody else's
 * attempt to finish. Racing this against it is what keeps "the wait ends when
 * the attempt does" true of every await in the call rather than only the last.
 *
 * It resolves rather than rejecting: what the abandonment means is decided by
 * the wait that follows, which reads the value one more time first — an attempt
 * that ended by producing an outcome is not an attempt that vanished.
 */
export function untilAbandoned(lifetime: AbortSignal): Promise<void> {
  if (lifetime.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    lifetime.addEventListener('abort', () => resolve(), { once: true });
  });
}

export interface AttemptRegistry {
  /** An id belonging to nobody, for an attempt no caller asked for by name. */
  mint(): AttemptId;
  /**
   * One attempt per lane, shared by everyone who asks while it is in flight.
   *
   * Minting the id and starting its lifetime is part of this rather than a step
   * beside it. A caller has to hold the id *before* the attempt it asked for
   * begins — that is the whole point of the id — and it has to be the id of the
   * attempt it is going to be told about, which for a joiner is the flight's and
   * not one of its own. Both facts are decided here, so there is one place that
   * decides them.
   *
   * `refresh()` used to promise a fresh REQ per call, and that promise sits
   * badly with what the cache is for. Two consumers of
   * one entry is the reason the query library is here; giving each call its own
   * attempt means the second cancels the first's fetch, so of two calls asking
   * one entry the same question at the same moment, one is answered and the
   * other is told its attempt was superseded. Sharing the attempt already in
   * flight is the answer the shared entry implies, and it is the reviewer's:
   * a REQ per call fits a shared cache worse than sharing the one in flight.
   *
   * **Resolve, reject and single-flight are `refresh()`'s published contract**,
   * so an implementation swap that changes them is not a swap the seam survives
   * (A11), whatever the types agree about. That is why this lives here rather
   * than in the engine, for the reason the ids do: the lane is the entry and not
   * the hook, so single-flight held beside one hook would let a second hook over
   * the same entry start a second attempt on it — the same reasoning that puts
   * the minting on the provider (A6).
   *
   * **What a joiner gives up**, stated rather than hidden: the attempt it shares
   * may have started before it called, so what it is told is that attempt's
   * answer rather than one taken at the moment it asked. What it gains is that
   * both calls get the same outcome, which two calls with an attempt each could
   * not have.
   *
   * The flight is the whole call and not just the attempt's start: a call that
   * arrives while an outcome is still being waited for joins it, and one that
   * arrives after the wait has ended starts an attempt of its own.
   */
  single<T>(lane: string, run: (id: AttemptId) => Promise<T>): Promise<T>;
  /** The id claimed for `lane`, if one was; otherwise a fresh one. */
  begin(lane: string): AttemptId;
  /**
   * Has anything picked this claim up?
   *
   * The question a caller asks after triggering something that was supposed to
   * start its attempt: a trigger that came back having opened no request leaves
   * the claim where it was, and the caller is then waiting for an attempt that
   * will never run. An id the registry does not know answers `true` — nobody is
   * waiting on it, so there is nothing to rescue.
   */
  begun(id: AttemptId): boolean;
  /**
   * The signal that fires when this attempt can no longer produce an outcome.
   *
   * Total: an id the registry does not know is one that was never claimed or has
   * already been abandoned, and neither can produce anything, so the signal for
   * it is already aborted.
   */
  lifetime(id: AttemptId): AbortSignal;
  /** Say it cannot. Idempotent, and a no-op for an attempt nobody waits on. */
  abandon(id: AttemptId, reason: string, as?: (message: string) => Error): void;
  /** The wait is over, however it ended. Nothing is listening any more. */
  release(id: AttemptId): void;
  /**
   * Every attempt still held, abandoned at once — what a provider calls on its
   * way out.
   *
   * **The registry was the one resource the provider's teardown did not
   * release.** It builds one, hands it to every request under it, and its
   * cleanup disposed the clock and the transport and left this: a destroyed
   * provider went on holding un-aborted `AbortController`s and a flight that
   * would never settle. Nothing a consumer holds could see it — a `refresh()`
   * in flight is abandoned through the query context's signal, which the
   * client's teardown aborts — so this keeps "everything it holds is released"
   * at the object rather than repairing a symptom.
   */
  /**
   * Abandon every attempt still held.
   *
   * **`as` is what the abandonment *is*, and it defaults to the generic one.**
   * A provider being destroyed is not the same event as a request being
   * superseded: the first ends with `provider-disposed` on whatever `refresh()`
   * was in flight — the owner is gone — and the second with `attempt-abandoned`.
   * Passing the value rather than a flag keeps the classification where the
   * caller knows it.
   */
  abandonAll(reason: string, as?: (message: string) => Error): void;
}

/** What is known about an attempt somebody is waiting for. */
interface PendingAttempt {
  readonly controller: AbortController;
  /**
   * Where the claim is parked until something begins it.
   *
   * Never absent. It was optional while a second engine claimed without a lane,
   * having no cache entry to name one with; that engine is gone, so a claim with
   * nowhere to be parked is a state nothing can reach.
   */
  readonly lane: string;
  begun: boolean;
}

export function createAttemptRegistry(): AttemptRegistry {
  const origin = `r${originToken()}`;
  let issued = 0;
  // One entry per lane with a claim outstanding, and a claim is normally picked
  // up by the fetch the same call triggers. A lane whose attempt never ran — a
  // refresh over a query that turned out to be disabled — keeps its claim until
  // the call gives up on it: the flight below releases whatever it claimed, and
  // releasing takes the lane with it. One lane never holds two, because a second
  // call joins the flight rather than claiming.
  //
  // **"And the call always does" stood here as a fact, and it is a dependency.**
  // Nothing in this module bounds a call: the release is in the flight's
  // `finally`, so a wait that never ends keeps its claim, keeps its lane in
  // `flights`, and hands every later `refresh()` on that lane the same promise
  // that is not going to settle. r13 reached exactly that — an accumulator that
  // resolved without ever calling its stream function left a claim marked begun,
  // an entry with no outcome carrying its id, and nothing that would ever write
  // one. What the sentence rests on is a property of the engine rather than of
  // this map: every way out of the query function either produces an outcome
  // stamped with the claim or ends the claim some other way — the entry takes
  // the claim, the stream's own `finally` abandons what it began, and the
  // return either abandons a claim whose invocation was torn down or **fails**
  // it with an {@link AccumulatorContractError} when nothing ended it at all
  // (`A11-C9`, `A11-C13`).
  // A failure is an outcome, an abandonment aborts the lifetime and the wait
  // ends on that; either way the flight settles, which is when this map lets go.

  const claimed = new Map<string, AttemptId>();
  // Only claimed ids are in here, because a claim is exactly an attempt somebody
  // is waiting for, and every claim has one waiter that releases it when its
  // wait ends however it ends. So this is bounded by the number of `refresh()`
  // calls in flight rather than by the number ever made.
  const awaited = new Map<AttemptId, PendingAttempt>();
  // One entry per lane with a call in flight. Deleted as that call settles —
  // before its promise resolves, so a caller that asks again from its own `then`
  // gets an attempt of its own rather than the one it has just been told about.
  const flights = new Map<string, Promise<unknown>>();

  const mint = (): AttemptId => {
    issued += 1;
    return `${origin}a${issued}` as AttemptId;
  };

  const release = (id: AttemptId): PendingAttempt | undefined => {
    const record = awaited.get(id);
    if (record === undefined) return undefined;
    // Removed before anything is aborted, so that an abort handler which calls
    // back in here — the waiter releasing in its own `finally` — finds nothing
    // rather than recursing.
    awaited.delete(id);
    if (claimed.get(record.lane) === id) claimed.delete(record.lane);
    return record;
  };

  /*
   * **The reason is an `Error` this library owns, not a value of the failure
   * channel**, and it was the second until `attempt-abandoned` left that
   * channel. An `AbortSignal` needs a reason; what a `refresh()` waiting on it
   * *publishes* is decided where the wait ends, by reading the reason's `code`
   * — the two lifetime ends resolve as `RefreshOutcome.cancelled`, and a
   * provider's disposal is the one that is still both.
   */
  const abandon = (
    id: AttemptId,
    reason: string,
    as: (message: string) => Error = (message) => ownedByLibrary(new AttemptAbandonedError(message))
  ): void => {
    release(id)?.controller.abort(as(reason));
  };

  const claim = (lane: string): AttemptId => {
    const id = mint();
    claimed.set(lane, id);
    awaited.set(id, { controller: new AbortController(), lane, begun: false });
    return id;
  };

  return {
    mint,
    single<T>(lane: string, run: (id: AttemptId) => Promise<T>): Promise<T> {
      const joined = flights.get(lane);
      // Nothing is checked about the flight before joining it: an attempt that
      // has ended is not in here, because the entry is removed as the call
      // settles. So "there is one" and "it can still answer" are one fact,
      // which is the property two conditions would eventually disagree about.
      if (joined !== undefined) return joined as Promise<T>;
      const id = claim(lane);
      const flight = (async () => {
        try {
          return await run(id);
        } finally {
          flights.delete(lane);
          // One claim, one flight, and this is where it ends — however it
          // ended. Releasing here rather than in the caller is what keeps the
          // registry bounded by the calls in flight, and it is the same line
          // for the call that started the attempt and the calls that joined it.
          release(id);
        }
      })();
      flights.set(lane, flight);
      return flight;
    },
    begin(lane: string): AttemptId {
      const id = claimed.get(lane);
      // Taken rather than read: an id is one attempt's, so a second attempt on
      // the lane that nobody claimed must not inherit the first one's stamp and
      // answer a `refresh()` that is still waiting for its own.
      claimed.delete(lane);
      if (id !== undefined) {
        const record = awaited.get(id);
        if (record !== undefined) record.begun = true;
      }
      return id ?? mint();
    },
    begun(id: AttemptId): boolean {
      return awaited.get(id)?.begun ?? true;
    },
    lifetime(id: AttemptId): AbortSignal {
      return (
        awaited.get(id)?.controller.signal ??
        AbortSignal.abort(
          ownedByLibrary(
            new AttemptAbandonedError('refresh() was waiting for an attempt that no longer exists.')
          )
        )
      );
    },
    abandon,
    release(id: AttemptId): void {
      release(id);
    },
    abandonAll(reason: string, as?: (message: string) => Error): void {
      // Over a copy of the keys: `abandon` deletes as it goes, and an abort
      // handler can release another id from inside this loop.
      for (const id of [...awaited.keys()]) abandon(id, reason, as);
      flights.clear();
      claimed.clear();
    }
  };
}
